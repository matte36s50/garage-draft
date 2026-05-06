import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * AUCTION HEALTH CHECK
 *
 * Read-only snapshot of the BaT finalization loop. Used by the Finalize tab
 * in the admin UI to surface:
 *   - stuck pile: BaT auctions ended >2h ago with no final_price and not flagged RNM
 *   - hours overdue of the oldest stuck auction (proxy for "is the cron running?")
 *   - 30-day end-state breakdown (sold / reserve_not_met / withdrawn / stuck / pending)
 *   - the most recent sold auction (proxy for last successful finalization)
 *
 * The auctions table has no updated_at column, so freshness is inferred from
 * timestamp_end. If the oldest stuck auction is <4h overdue, the 30-min cron is
 * keeping up. If it's days overdue, something is wrong.
 *
 * No auth: this route is only reachable through the admin UI, which is already gated.
 */

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function GET() {
  const supabase = getSupabaseClient();
  const now = Math.floor(Date.now() / 1000);
  const twoHoursAgo = now - 2 * 60 * 60;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

  try {
    const { data: stuckSample, error: stuckErr } = await supabase
      .from('auctions')
      .select('auction_id, title, url, timestamp_end')
      .lt('timestamp_end', twoHoursAgo)
      .is('final_price', null)
      .eq('reserve_not_met', false)
      .ilike('url', '%bringatrailer.com%')
      .order('timestamp_end', { ascending: true })
      .limit(10);

    if (stuckErr) throw stuckErr;

    const { count: stuckCount, error: stuckCountErr } = await supabase
      .from('auctions')
      .select('auction_id', { count: 'exact', head: true })
      .lt('timestamp_end', twoHoursAgo)
      .is('final_price', null)
      .eq('reserve_not_met', false)
      .ilike('url', '%bringatrailer.com%');

    if (stuckCountErr) throw stuckCountErr;

    const oldestStuckHoursOverdue = stuckSample?.[0]
      ? Math.round((now - stuckSample[0].timestamp_end) / 3600)
      : 0;

    const { data: recent, error: recentErr } = await supabase
      .from('auctions')
      .select('final_price, reserve_not_met, timestamp_end')
      .gte('timestamp_end', thirtyDaysAgo)
      .lt('timestamp_end', now);

    if (recentErr) throw recentErr;

    const breakdown = { sold: 0, withdrawn: 0, reserveNotMet: 0, stuck: 0, recentlyEnded: 0 };
    for (const a of recent || []) {
      if (a.final_price === null) {
        if (a.reserve_not_met) breakdown.reserveNotMet++;
        else if (a.timestamp_end < twoHoursAgo) breakdown.stuck++;
        else breakdown.recentlyEnded++;
      } else if (Number(a.final_price) === 0) {
        breakdown.withdrawn++;
      } else {
        breakdown.sold++;
      }
    }

    const { data: lastSoldRows, error: lastSoldErr } = await supabase
      .from('auctions')
      .select('auction_id, title, final_price, timestamp_end, url')
      .gt('final_price', 0)
      .order('timestamp_end', { ascending: false })
      .limit(1);

    if (lastSoldErr) throw lastSoldErr;

    const lastSold = lastSoldRows?.[0]
      ? {
          auction_id: lastSoldRows[0].auction_id,
          title: lastSoldRows[0].title,
          url: lastSoldRows[0].url,
          final_price: Number(lastSoldRows[0].final_price),
          ended_at: new Date(lastSoldRows[0].timestamp_end * 1000).toISOString(),
          hours_since_end: Math.round((now - lastSoldRows[0].timestamp_end) / 3600),
        }
      : null;

    let status = 'healthy';
    if (stuckCount > 0 && oldestStuckHoursOverdue >= 24) status = 'critical';
    else if (stuckCount > 0 && oldestStuckHoursOverdue >= 4) status = 'warning';

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      status,
      stuck: {
        count: stuckCount || 0,
        oldestHoursOverdue: oldestStuckHoursOverdue,
        sample: (stuckSample || []).map((r) => ({
          auction_id: r.auction_id,
          title: r.title,
          url: r.url,
          ended_at: new Date(r.timestamp_end * 1000).toISOString(),
          hours_overdue: Math.round((now - r.timestamp_end) / 3600),
        })),
      },
      last30Days: breakdown,
      lastSold,
    });
  } catch (error) {
    console.error('Auction health error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
