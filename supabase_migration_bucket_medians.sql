-- Migration: bucket trailing medians + the comparable-set drill-down
--
-- WHY: every analytics board that compares a lot to "what this model is worth"
-- needs one number first — the bucket's trailing-12m median. Today nothing
-- computes it, so /api/store/listings can only return raw rows (capped at 500)
-- and the browser would have to page the whole store to work out a median.
-- That is the wrong place to do it. This puts the aggregate in Postgres, where
-- the data already is.
--
-- Two objects:
--   auction_bucket_medians   view — one row per bucket, trailing 12m vs the
--                            12m before it. This is the denominator other
--                            boards (demand deciles, online-vs-live) will reuse.
--   auction_bucket_detail()  rpc  — everything the Comparables tab draws for
--                            ONE bucket, in a single round trip.
--
-- IMPORTANT: run this in the CANONICAL Supabase project — the one
-- CANONICAL_SUPABASE_URL points at, where auction_listings_all lives. It is
-- NOT the game project that the root-level auctions-table migrations target.
--
-- Read-only: creates a view and a function, touches no existing object and
-- writes no rows. Safe to re-run (create or replace).

-- ---------------------------------------------------------------------------
-- Price basis
--
-- Everything below values a lot at coalesce(price_all_in, price): the all-in
-- price where a buyer premium has been computed, otherwise the hammer. Mixing
-- the two understates any bucket whose lots came from catalogue houses, so
-- lots_missing_all_in is surfaced per bucket rather than hidden — a bucket
-- with a high count there should be read with that in mind.
--
-- Currency: the live-entry route converts to USD on write, and the scraped
-- sources are USD, so amounts are treated as USD. Rows carrying a non-USD
-- currency are excluded rather than silently mixed into a median.
-- ---------------------------------------------------------------------------

create or replace view auction_bucket_medians as
with ended as (
  select
    l.canonical_model_id                        as bucket_id,
    coalesce(l.price_all_in, l.price)::numeric  as amount,
    (l.price_all_in is null and l.price is not null) as hammer_only,
    l.outcome,
    (l.ended_at >= now() - interval '12 months') as cur,
    (l.ended_at <  now() - interval '12 months'
     and l.ended_at >= now() - interval '24 months') as prior
  from auction_listings_all l
  where l.canonical_model_id is not null
    and l.status = 'ended'
    and l.ended_at is not null
    and coalesce(l.currency, 'USD') = 'USD'
),
agg as (
  select
    b.id as bucket_id, b.make, b.model, b.generation, b.year_min, b.year_max,

    count(*) filter (where e.cur)                                        as lots_12m,
    count(*) filter (where e.cur and e.outcome = 'sold')                 as sold_12m,
    count(*) filter (where e.cur and e.outcome = 'reserve_not_met')      as rnm_12m,
    count(*) filter (where e.cur and e.outcome = 'sold' and e.hammer_only) as lots_missing_all_in,

    round((percentile_cont(0.50) within group (order by e.amount)
      filter (where e.cur and e.outcome = 'sold' and e.amount > 0))::numeric)   as median_12m,
    round((percentile_cont(0.25) within group (order by e.amount)
      filter (where e.cur and e.outcome = 'sold' and e.amount > 0))::numeric)   as p25_12m,
    round((percentile_cont(0.75) within group (order by e.amount)
      filter (where e.cur and e.outcome = 'sold' and e.amount > 0))::numeric)   as p75_12m,

    count(*) filter (where e.prior and e.outcome = 'sold')               as sold_prior_12m,
    round((percentile_cont(0.50) within group (order by e.amount)
      filter (where e.prior and e.outcome = 'sold' and e.amount > 0))::numeric) as median_prior_12m
  from auction_buckets b
  left join ended e on e.bucket_id = b.id
  group by b.id, b.make, b.model, b.generation, b.year_min, b.year_max
)
select
  a.bucket_id, a.make, a.model, a.generation, a.year_min, a.year_max,
  a.lots_12m, a.sold_12m, a.rnm_12m, a.lots_missing_all_in,
  a.median_12m,
  -- Quartiles need at least four sales to describe a spread. Below that they
  -- collapse onto the median and would report an interquartile range of $0 —
  -- a confident-looking number built from one car.
  case when a.sold_12m >= 4 then a.p25_12m end                     as p25_12m,
  case when a.sold_12m >= 4 then a.p75_12m end                     as p75_12m,
  case when a.sold_12m >= 4 then a.p75_12m - a.p25_12m end          as iqr_12m,
  a.sold_prior_12m, a.median_prior_12m,
  -- Sell-through over lots that actually reached a result this window.
  case when a.lots_12m > 0
       then round(100.0 * a.sold_12m / a.lots_12m, 1) end          as sell_through_12m,
  -- Year-over-year move. Guarded on BOTH windows having enough lots to mean
  -- anything: a median built on one sale is not a price, so no delta is
  -- offered below three either side.
  case when a.sold_12m >= 3 and a.sold_prior_12m >= 3 and a.median_prior_12m > 0
       then round(100.0 * (a.median_12m / a.median_prior_12m - 1), 1) end as change_pct_12m
from agg a;

comment on view auction_bucket_medians is
  'Per-bucket trailing-12m price medians vs the preceding 12m. Sold lots only for '
  'the medians; all ended lots for sell-through. Amounts are coalesce(price_all_in, price), USD.';


-- ---------------------------------------------------------------------------
-- auction_bucket_detail(bucket, months)
--
-- One round trip for the Comparables tab:
--   bucket      the auction_bucket_medians row
--   by_year     median + count per model year (the scatter's trend line)
--   by_quarter  median + IQR + count per quarter (the trend chart)
--   lots        every ended lot in range (the scatter points and comps table)
--
-- by_year and by_quarter suppress groups with fewer than 2 sales: a "median"
-- of one car is that car's price wearing a statistic's clothes.
-- ---------------------------------------------------------------------------

create or replace function auction_bucket_detail(
  p_bucket_id uuid,
  p_months    int default 24
)
returns jsonb
language sql
stable
as $$
with scope as (
  select
    l.id, l.source_id, l.source_listing_id, l.raw_title, l.year, l.url,
    l.outcome, l.ended_at, l.event_id, l.currency,
    l.price, l.price_all_in, l.estimate_low, l.estimate_high,
    l.watchers, l.bid_count,
    coalesce(l.price_all_in, l.price)::numeric as amount
  from auction_listings_all l
  where l.canonical_model_id = p_bucket_id
    and l.status = 'ended'
    and l.ended_at is not null
    and l.ended_at >= now() - make_interval(months => greatest(p_months, 1))
    and coalesce(l.currency, 'USD') = 'USD'
),
sold as (
  select * from scope where outcome = 'sold' and amount > 0
)
select jsonb_build_object(

  'bucket', (
    select to_jsonb(m) from auction_bucket_medians m where m.bucket_id = p_bucket_id
  ),

  'months', greatest(p_months, 1),

  'by_year', coalesce((
    select jsonb_agg(t order by t.year)
    from (
      select year,
             count(*)                                                    as n,
             round((percentile_cont(0.5) within group (order by amount))::numeric) as median
      from sold
      where year is not null
      group by year
      having count(*) >= 2
    ) t
  ), '[]'::jsonb),

  'by_quarter', coalesce((
    select jsonb_agg(t order by t.quarter)
    from (
      select date_trunc('quarter', ended_at)::date                        as quarter,
             count(*)                                                     as n,
             round((percentile_cont(0.25) within group (order by amount))::numeric) as p25,
             round((percentile_cont(0.50) within group (order by amount))::numeric) as median,
             round((percentile_cont(0.75) within group (order by amount))::numeric) as p75
      from sold
      group by 1
      having count(*) >= 2
    ) t
  ), '[]'::jsonb),

  -- Reserve-not-met lots are kept, valued at their high bid, and flagged. They
  -- are excluded from every median above but belong on the scatter: dropping
  -- them would quietly bias the picture toward cars that found a buyer.
  'lots', coalesce((
    select jsonb_agg(t order by t.ended_at desc)
    from (
      select id, source_id, source_listing_id, raw_title, year, url, outcome,
             ended_at, event_id, price, price_all_in, amount,
             estimate_low, estimate_high, watchers, bid_count
      from scope
      where amount > 0
      limit 500
    ) t
  ), '[]'::jsonb)
);
$$;

comment on function auction_bucket_detail(uuid, int) is
  'Everything the Comparables tab renders for one bucket: headline medians, per-year and '
  'per-quarter series (groups of 2+ sales only), and the underlying ended lots.';


-- ---------------------------------------------------------------------------
-- Grants. The app reads with the service key, which bypasses RLS, but the
-- objects still have to be visible to PostgREST.
-- ---------------------------------------------------------------------------
grant select   on auction_bucket_medians to service_role;
grant execute  on function auction_bucket_detail(uuid, int) to service_role;

-- Success.
-- Verify with:
--   select make, model, lots_12m, sold_12m, median_12m, change_pct_12m
--   from auction_bucket_medians
--   where sold_12m >= 3
--   order by sold_12m desc
--   limit 20;
