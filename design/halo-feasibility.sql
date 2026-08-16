-- ============================================================================
-- Halo feasibility: does online attention (BaT / Cars & Bids) lead live-sale
-- prices at premier auctions?
--
-- Run these four in order against the CANONICAL store. Each one can kill the
-- study on its own, so stop at the first that comes back thin. Column names
-- are taken from what the app reads today (app/api/store/*, lib/canonicalStore.js);
-- adjust if auction_listings_all has drifted.
--
-- The decision rule is at the bottom of each query.
-- ============================================================================


-- ── 1. Do we have live-auction results at all, and from whom? ───────────────
-- The whole study rests on the live side, which is hand-entered via
-- /api/store/entry, so this is the first thing that can be empty.

select
  coalesce(e.house, l.source_id)          as house,
  e.name                                  as event,
  date_trunc('quarter', l.ended_at)::date as quarter,
  count(*)                                as lots,
  count(*) filter (where l.outcome = 'sold')            as sold,
  count(*) filter (where l.estimate_low is not null)    as with_estimate,
  count(*) filter (where l.canonical_model_id is not null) as bucketed,
  round(avg(l.price_all_in)::numeric)     as avg_all_in
from auction_listings_all l
left join auction_events_all e on e.id = l.event_id
where l.status = 'ended'
  and l.event_id is not null          -- live/catalogue lots carry an event
group by 1, 2, 3
order by quarter desc, lots desc;

-- DECISION: you need >= 4 distinct quarters containing live sales to fit any
-- lead-lag at all. Monterey alone is ONE quarter a year -> 2 years of data is
-- 2 observations, which cannot support the lag chart on board 05. If this
-- comes back Monterey-only, broaden "live" to Amelia / Arizona / Rétromobile /
-- Goodwood before going further. That single change is usually the difference
-- between an unanswerable and an answerable question.


-- ── 2. Is engagement actually populated on the online side? ─────────────────
-- Note: the finalize-auctions cron only scrapes stats for bringatrailer.com
-- URLs. Cars & Bids engagement arrives only if an external scraper POSTs to
-- /api/scrape/import or /api/scrape/update-bids, so it may be near-zero.

select
  l.source_id,
  date_trunc('quarter', l.ended_at)::date as quarter,
  count(*)                                             as ended_lots,
  count(l.watchers)                                    as have_watchers,
  count(l.views)                                       as have_views,
  count(l.bid_count)                                   as have_bids,
  round(100.0 * count(l.watchers) / nullif(count(*), 0), 1) as pct_watchers
from auction_listings_all l
where l.status = 'ended'
  and l.source_id in ('bat', 'carsandbids')
group by 1, 2
order by quarter desc, l.source_id;

-- DECISION: pct_watchers needs to be high (>60%) and STABLE across quarters.
-- A coverage rate that jumps when you deployed the stats scraper creates a
-- fake trend -- engagement would look like it "grew" because collection did.
-- Restrict the study window to quarters where coverage is already flat.


-- ── 3. The overlap: buckets that trade in BOTH markets ─────────────────────
-- This is the real constraint. Bucketing is what makes the join possible at
-- all, so unbucketed lots are invisible here by construction.

with online as (
  select canonical_model_id                as bucket_id,
         count(*)                          as online_lots,
         percentile_cont(0.5) within group (order by watchers) as med_watchers,
         percentile_cont(0.5) within group (order by price_all_in) as online_comp
  from auction_listings_all
  where status = 'ended'
    and outcome = 'sold'
    and source_id in ('bat', 'carsandbids')
    and canonical_model_id is not null
    and watchers is not null
    and ended_at >= now() - interval '24 months'
  group by 1
),
live as (
  select l.canonical_model_id             as bucket_id,
         count(*)                         as live_lots,
         count(distinct date_trunc('quarter', l.ended_at)) as live_quarters,
         percentile_cont(0.5) within group (order by l.price_all_in) as live_med
  from auction_listings_all l
  where l.status = 'ended'
    and l.outcome = 'sold'
    and l.event_id is not null
    and l.canonical_model_id is not null
    and l.ended_at >= now() - interval '24 months'
  group by 1
)
select
  b.make, b.model, b.generation,
  o.online_lots, o.med_watchers, round(o.online_comp::numeric)  as online_comp,
  v.live_lots,  v.live_quarters, round(v.live_med::numeric)     as live_med,
  round((v.live_med / nullif(o.online_comp, 0))::numeric, 3)    as live_over_online
from online o
join live  v on v.bucket_id = o.bucket_id
join auction_buckets b on b.id = o.bucket_id
where o.online_lots >= 3
  and v.live_lots   >= 3
order by v.live_lots desc, o.online_lots desc;

-- DECISION: this row count IS your n for the correlation on board 05.
--   n >= 25  -> the cross-sectional scatter is worth publishing
--   n 12-24  -> report it with the coverage table visible and no lag claim
--   n <  12  -> not yet a finding; it is an anecdote with a trendline


-- ── 4. Power check: can a LEAD-LAG be fitted, or only a correlation? ───────
-- A lag needs the same bucket observed in several distinct quarters on the
-- live side. Cross-sectional correlation does not.

with live_q as (
  select canonical_model_id as bucket_id,
         date_trunc('quarter', ended_at) as q,
         count(*) as lots
  from auction_listings_all
  where status = 'ended' and outcome = 'sold'
    and event_id is not null and canonical_model_id is not null
  group by 1, 2
  having count(*) >= 2
)
select
  count(distinct bucket_id)                              as buckets_with_live_data,
  count(distinct q)                                      as distinct_live_quarters,
  round(avg(qcount), 2)                                  as avg_quarters_per_bucket,
  count(*) filter (where qcount >= 4)                    as buckets_with_4plus_quarters
from (
  select bucket_id, count(*) as qcount from live_q group by 1
) s, lateral (select 1) _
group by ();

-- DECISION: buckets_with_4plus_quarters is the honest ceiling on the lag
-- analysis. Below ~10 such buckets, board 05's lag chart is decoration --
-- ship the scatter and the coverage table, and label the lag "not yet
-- estimable" rather than publishing a number nobody can defend.


-- ============================================================================
-- KNOWN BIAS TO FIX BEFORE ANY OF THIS IS CAUSAL
--
-- watchers/views are scraped by finalize-auctions AT FINALISATION, i.e. after
-- the auction closed. A closing watcher count is partly an EFFECT of the
-- bidding it is being used to predict, so any correlation is inflated.
--
-- The fix is forward-only and cheap: snapshot watchers/views at a fixed point
-- before close (T-48h pairs naturally with the existing price_at_48h) and
-- store it as its own column. Until that exists, board 03 and board 05 are
-- descriptive, not predictive -- which is worth stating on the page rather
-- than discovering in review.
-- ============================================================================
