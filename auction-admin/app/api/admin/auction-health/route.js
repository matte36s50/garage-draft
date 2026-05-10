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
 *   - chat-loop check: of drafted+sold auctions in last 7 days, how many got a
 *     league_messages 'system_auction_ended' row (the SQL trigger fires per
 *     garage_car, so this only counts auctions someone actually drafted)
 *   - suspicious withdrawns: final_price=0 but current_bid>0 (the lambda's
 *     withdrawn detection has been over-classifying; these are likely RNM)
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
  const sevenDaysAgo = now - 7 * 24 * 60 * 60;
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

    // Chat-loop check: drafted + sold in the last 7 days should have a
    // 'system_auction_ended' message in league_messages. The SQL trigger only
    // fires per garage_cars row, so we scope to auctions someone drafted.
    const { data: drafted, error: draftedErr } = await supabase
      .from('garage_cars')
      .select('auction_id, auctions!inner(auction_id, title, final_price, timestamp_end)')
      .gte('auctions.timestamp_end', sevenDaysAgo)
      .lt('auctions.timestamp_end', now)
      .gt('auctions.final_price', 0)
      .limit(2000);

    if (draftedErr) throw draftedErr;

    const draftedSoldById = new Map();
    for (const row of drafted || []) {
      const a = row.auctions;
      if (a && !draftedSoldById.has(a.auction_id)) {
        draftedSoldById.set(a.auction_id, a);
      }
    }
    const draftedSoldIds = [...draftedSoldById.keys()];

    let chatLoop = { draftedSold: 0, chatPosted: 0, missing: [] };
    if (draftedSoldIds.length > 0) {
      const notified = new Set();
      const chunkSize = 100;
      for (let i = 0; i < draftedSoldIds.length; i += chunkSize) {
        const slice = draftedSoldIds.slice(i, i + chunkSize);
        const { data: msgs, error: msgErr } = await supabase
          .from('league_messages')
          .select('metadata')
          .eq('message_type', 'system_auction_ended')
          .in('metadata->>auction_id', slice);
        if (msgErr) throw msgErr;
        for (const m of msgs || []) {
          const id = m.metadata?.auction_id;
          if (id) notified.add(id);
        }
      }

      const missing = [];
      for (const id of draftedSoldIds) {
        if (!notified.has(id)) {
          const a = draftedSoldById.get(id);
          missing.push({
            auction_id: id,
            title: a.title,
            final_price: Number(a.final_price),
            ended_at: new Date(a.timestamp_end * 1000).toISOString(),
            hours_since_end: Math.round((now - a.timestamp_end) / 3600),
          });
        }
      }
      missing.sort((a, b) => b.hours_since_end - a.hours_since_end);

      chatLoop = {
        draftedSold: draftedSoldIds.length,
        chatPosted: notified.size,
        missing: missing.slice(0, 10),
        missingCount: missing.length,
      };
    }

    // Suspicious withdrawns: final_price=0 but had bidding activity (current_bid>0).
    // The python lambda's withdrawn regex + 404-handler is over-classifying these;
    // they should almost certainly be reserve_not_met instead.
    const { data: suspicious, error: susErr } = await supabase
      .from('auctions')
      .select('auction_id, title, url, current_bid, timestamp_end')
      .eq('final_price', 0)
      .gt('current_bid', 0)
      .gte('timestamp_end', thirtyDaysAgo)
      .order('timestamp_end', { ascending: false })
      .limit(50);

    if (susErr) throw susErr;

    const { count: suspiciousCount, error: susCountErr } = await supabase
      .from('auctions')
      .select('auction_id', { count: 'exact', head: true })
      .eq('final_price', 0)
      .gt('current_bid', 0)
      .gte('timestamp_end', thirtyDaysAgo);

    if (susCountErr) throw susCountErr;

    const suspiciousWithdrawn = {
      count: suspiciousCount || 0,
      sample: (suspicious || []).map((r) => ({
        auction_id: r.auction_id,
        title: r.title,
        url: r.url,
        current_bid: Number(r.current_bid),
        ended_at: new Date(r.timestamp_end * 1000).toISOString(),
      })),
    };

    let status = 'healthy';
    if (stuckCount > 0 && oldestStuckHoursOverdue >= 24) status = 'critical';
    else if (stuckCount > 0 && oldestStuckHoursOverdue >= 4) status = 'warning';
    else if (chatLoop.missingCount > 0) status = 'warning';
    else if (suspiciousWithdrawn.count > 0) status = 'warning';

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
      chatLoop,
      suspiciousWithdrawn,
    });
  } catch (error) {
    console.error('Auction health error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
