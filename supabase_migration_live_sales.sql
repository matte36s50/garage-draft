-- Migration: live-sale results, and the live-vs-online price split
--
-- WHY: the question this answers is "what did the top-tier rooms actually
-- realize, and how does that compare to where the same cars trade online".
-- That comparison is deliberately NOT made against house estimates: the houses
-- read the online market too, so an estimate has already absorbed the signal.
-- It is made against the online median for the same bucket.
--
-- Two objects:
--   auction_event_results      view — one row per live sale: lots, sell-through,
--                              total realized, median, top lot, plus the two
--                              coverage counts that say how far to trust it.
--   auction_bucket_venue_split view — per bucket, the online median beside the
--                              live median and the ratio between them. This is
--                              the halo measure.
--
-- Run in the CANONICAL Supabase project (CANONICAL_SUPABASE_URL), same place as
-- supabase_migration_bucket_medians.sql. Creates views only; writes no rows;
-- safe to re-run.
--
-- Definitions used throughout:
--   live   = the lot belongs to an auction event (event_id is not null)
--   online = no event, from a marketplace source (bat / carsandbids)
--   amount = coalesce(price_all_in, price) — all-in where a buyer premium was
--            computed, hammer otherwise
--
-- Currency: /api/store/entry converts non-USD lots to USD on write and keeps
-- the original under original_currency + fx_rate_usd, so filtering to USD here
-- keeps everything and mixes nothing.


-- ---------------------------------------------------------------------------
-- Per-event results
--
-- bucketed_pct and all_in_pct are not decoration. A lot with no bucket cannot
-- be compared to the online market at all, and a lot with no premium computed
-- is being counted at hammer while online lots are counted all-in — a ~10%
-- understatement. Both belong next to the headline, not in a footnote.
-- ---------------------------------------------------------------------------

create or replace view auction_event_results as
with lots as (
  select
    l.event_id,
    coalesce(l.price_all_in, l.price)::numeric as amount,
    l.outcome,
    l.ended_at,
    (l.canonical_model_id is not null) as bucketed,
    (l.price_all_in is not null)       as has_all_in
  from auction_listings_all l
  where l.event_id is not null
    and l.status = 'ended'
    and coalesce(l.currency, 'USD') = 'USD'
),
agg as (
  select
    e.id as event_id, e.name, e.house, e.location,
    min(x.ended_at)::date                                            as sale_date,
    count(*)                                                         as lots,
    count(*) filter (where x.outcome = 'sold')                       as sold,
    count(*) filter (where x.outcome = 'reserve_not_met')            as rnm,
    sum(x.amount) filter (where x.outcome = 'sold' and x.amount > 0) as total_realized,
    round((percentile_cont(0.50) within group (order by x.amount)
      filter (where x.outcome = 'sold' and x.amount > 0))::numeric)  as median_realized,
    max(x.amount) filter (where x.outcome = 'sold')                  as top_lot,
    count(*) filter (where x.bucketed)                               as bucketed_lots,
    count(*) filter (where x.has_all_in)                             as all_in_lots
  from auction_events_all e
  join lots x on x.event_id = e.id
  group by e.id, e.name, e.house, e.location
)
select
  a.*,
  case when a.lots > 0 then round(100.0 * a.sold / a.lots, 1) end          as sell_through,
  case when a.lots > 0 then round(100.0 * a.bucketed_lots / a.lots, 1) end as bucketed_pct,
  case when a.lots > 0 then round(100.0 * a.all_in_lots / a.lots, 1) end   as all_in_pct
from agg a;

comment on view auction_event_results is
  'One row per live auction event: lots, sell-through, total realized, median and top lot, '
  'with bucket and all-in coverage so the headline can be weighted by how complete it is.';


-- ---------------------------------------------------------------------------
-- Live vs online, per bucket  —  the halo measure
--
-- live_over_online > 1 means the room paid more than the same model fetches
-- online over the same period.
--
-- LIMITATION, deliberately not hidden: both medians span the whole window
-- rather than being matched quarter-to-quarter. With live sales clustered into
-- a handful of events a year there is not enough overlap to do better yet, so
-- a bucket whose online price moved sharply mid-window will show part of that
-- move as a venue effect. Read the ratio as a comparison, not a causal premium.
-- ---------------------------------------------------------------------------

create or replace view auction_bucket_venue_split as
with sold as (
  select
    l.canonical_model_id                       as bucket_id,
    coalesce(l.price_all_in, l.price)::numeric as amount,
    (l.event_id is not null)                   as is_live,
    l.watchers,
    l.ended_at
  from auction_listings_all l
  where l.canonical_model_id is not null
    and l.status = 'ended'
    and l.outcome = 'sold'
    and coalesce(l.currency, 'USD') = 'USD'
    and coalesce(l.price_all_in, l.price) > 0
),
agg as (
  select
    b.id as bucket_id, b.make, b.model, b.generation,

    count(*) filter (where not s.is_live)                            as online_n,
    count(*) filter (where s.is_live)                                as live_n,

    round((percentile_cont(0.50) within group (order by s.amount)
      filter (where not s.is_live))::numeric)                        as online_median,
    round((percentile_cont(0.50) within group (order by s.amount)
      filter (where s.is_live))::numeric)                            as live_median,

    max(s.amount) filter (where s.is_live)                           as live_top,
    round(avg(s.watchers) filter (where not s.is_live))              as online_avg_watchers,
    max(s.ended_at) filter (where s.is_live)                         as last_live_sale
  from auction_buckets b
  join sold s on s.bucket_id = b.id
  group by b.id, b.make, b.model, b.generation
)
select
  a.*,
  -- Needs a real median on both sides. Live sales are scarce, so the live floor
  -- is 2 rather than 4 — but the ratio is published alongside live_n so a
  -- two-lot comparison can never masquerade as a twenty-lot one.
  case when a.online_n >= 3 and a.live_n >= 2 and a.online_median > 0
       then round(a.live_median / a.online_median, 3) end as live_over_online
from agg a;

comment on view auction_bucket_venue_split is
  'Per bucket: median online price beside median live-sale price, and the ratio between them. '
  'Ratio published only where online_n>=3 and live_n>=2; both counts are exposed so thin '
  'comparisons stay visible.';


grant select on auction_event_results      to service_role;
grant select on auction_bucket_venue_split to service_role;

-- Verify with:
--   select house, name, sale_date, lots, sold, sell_through, total_realized,
--          bucketed_pct, all_in_pct
--   from auction_event_results order by sale_date desc;
--
--   select make, model, online_n, online_median, live_n, live_median, live_over_online
--   from auction_bucket_venue_split
--   where live_over_online is not null
--   order by live_over_online desc;
