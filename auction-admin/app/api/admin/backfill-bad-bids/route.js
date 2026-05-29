import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';

/**
 * BACKFILL BAD HIGH BIDS / WRONGLY-WITHDRAWN AUCTIONS
 *
 * One-shot cleanup for the legacy mess the old scraper left behind:
 *
 *   1. "Suspicious withdrawn" pile — final_price=0 but current_bid>0. These
 *      had real bidding, so they almost certainly were Reserve Not Met, not
 *      withdrawn. We flip them to reserve_not_met=true / final_price=null.
 *
 *   2. Bogus high bids — a current_bid below MIN_PLAUSIBLE (e.g. the legacy
 *      "$10" placeholder) is not a real bid. We null it out so the app stops
 *      showing "$10 high bid" and RNM scoring falls back sensibly. A plausible
 *      current_bid (>= threshold) is preserved as the genuine high bid.
 *
 * These rows can't be reliably re-scraped (BaT/Cloudflare), so this fixes them
 * deterministically. The forward-looking fix lives in the finalizer parser.
 *
 * Safe by default: a GET (or POST without apply:true) is a DRY RUN that only
 * reports what WOULD change. Pass { "apply": true } to actually write.
 *
 * The notify_auction_ended trigger only fires on NULL -> non-NULL final_price
 * transitions, so flipping 0 -> null here posts no spurious chat messages.
 *
 * Auth: requires an admin session cookie or the cron secret (verifyAdminRequest).
 */

const MIN_PLAUSIBLE_PRICE = 100;

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

async function run(request, apply, threshold) {
  const supabase = getSupabaseClient();

  // Count helper (head request, exact count)
  const count = async (build) => {
    const { count: c, error } = await build(
      supabase.from('auctions').select('auction_id', { count: 'exact', head: true })
    );
    if (error) throw error;
    return c || 0;
  };

  // Group 1a: withdrawn-with-bids AND bogus bid -> RNM + clear bid
  const q1a = (q) => q.eq('final_price', 0).gt('current_bid', 0).lt('current_bid', threshold);
  // Group 1b: withdrawn-with-bids AND plausible bid -> RNM, keep bid
  const q1b = (q) => q.eq('final_price', 0).gte('current_bid', threshold);
  // Group 2: already-RNM rows still carrying a bogus bid -> clear bid only
  const q2 = (q) =>
    q.eq('reserve_not_met', true).gt('current_bid', 0).lt('current_bid', threshold);

  const plan = {
    withdrawnBogusBid_toRnm: await count(q1a),
    withdrawnRealBid_toRnm: await count(q1b),
    rnmBogusBid_cleared: await count(q2),
  };

  // A small sample for sanity-checking before applying
  const { data: sample } = await q1a(
    supabase
      .from('auctions')
      .select('auction_id, title, current_bid, final_price, url')
  ).limit(10);

  if (!apply) {
    return NextResponse.json({
      dryRun: true,
      threshold,
      wouldChange: plan,
      total: plan.withdrawnBogusBid_toRnm + plan.withdrawnRealBid_toRnm + plan.rnmBogusBid_cleared,
      sample: (sample || []).map((r) => ({
        auction_id: r.auction_id,
        title: r.title,
        current_bid: Number(r.current_bid),
      })),
      note: 'Dry run — nothing was written. POST { "apply": true } to commit.',
    });
  }

  // Apply. Order matters: clear bogus bids first, then flip plausible ones,
  // so a single row is never double-counted across groups.
  const applied = {};

  {
    const { error, count: c } = await q1a(
      supabase
        .from('auctions')
        .update({ reserve_not_met: true, final_price: null, current_bid: null }, { count: 'exact' })
    );
    if (error) throw error;
    applied.withdrawnBogusBid_toRnm = c || 0;
  }
  {
    const { error, count: c } = await q1b(
      supabase
        .from('auctions')
        .update({ reserve_not_met: true, final_price: null }, { count: 'exact' })
    );
    if (error) throw error;
    applied.withdrawnRealBid_toRnm = c || 0;
  }
  {
    const { error, count: c } = await q2(
      supabase.from('auctions').update({ current_bid: null }, { count: 'exact' })
    );
    if (error) throw error;
    applied.rnmBogusBid_cleared = c || 0;
  }

  return NextResponse.json({
    dryRun: false,
    threshold,
    applied,
    total: Object.values(applied).reduce((a, b) => a + b, 0),
  });
}

function parseThreshold(value) {
  if (value === undefined || value === null || value === '') return MIN_PLAUSIBLE_PRICE;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : MIN_PLAUSIBLE_PRICE;
}

// GET = dry run (easy to preview from a browser/cron with the secret)
export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  try {
    return await run(request, false, parseThreshold(searchParams.get('threshold')));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST { apply, threshold } = write when apply is true, otherwise dry run
export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty body = dry run with defaults */
  }
  try {
    return await run(request, body?.apply === true, parseThreshold(body?.threshold));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
