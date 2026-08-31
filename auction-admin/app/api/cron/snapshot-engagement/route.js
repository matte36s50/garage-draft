import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * ENGAGEMENT SNAPSHOT — latch watchers/views/bids while the auction is LIVE.
 *
 * WHY: finalize-auctions records engagement when an auction ENDS, which makes
 * `watchers` a closing count — inflated by the very bidding it would be used to
 * predict. A count taken before the close is not circular, and is the one that
 * can actually forecast. See supabase_migration_engagement_snapshot.sql.
 *
 * This route finds live auctions inside the snapshot window that have not been
 * latched yet and copies whatever engagement the scraper has most recently
 * pushed into the *_at_48h columns. It writes each auction at most once ever
 * (engagement_snapshot_at is the latch), so re-running is free and a missed run
 * only costs lead time, never a double-write.
 *
 * SCHEDULE: every 30-60 minutes, on the same external cron service as
 * finalize-auctions:
 *   GET /api/cron/snapshot-engagement?secret=YOUR_CRON_SECRET
 *
 * PARAMS (all optional):
 *   max_hours=48   latch auctions ending within this many hours
 *   min_hours=36   ...but not sooner than this, so a slow cron cannot latch a
 *                  value taken an hour before close and label it a 48h figure
 *   limit=500      auctions per run
 *   dry_run=true   report what would be latched, write nothing
 *
 * Auctions that pass through the window with no engagement recorded are simply
 * left unlatched — a snapshot of nothing is worse than none, because it would
 * look like genuine zero interest.
 */

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function GET(request) { return snapshot(request); }
export async function POST(request) { return snapshot(request); }

async function snapshot(request) {
  const { searchParams } = new URL(request.url);
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const ok = authHeader === `Bearer ${cronSecret}` || searchParams.get('secret') === cronSecret;
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const maxHours = Math.min(Math.max(parseInt(searchParams.get('max_hours') || '48', 10) || 48, 1), 240);
  const minHours = Math.min(Math.max(parseInt(searchParams.get('min_hours') || '36', 10) || 36, 0), maxHours);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 1000);
  const dryRun = searchParams.get('dry_run') === 'true';

  const supabase = getSupabaseClient();
  const nowSec = Math.floor(Date.now() / 1000);
  const windowOpen = nowSec + minHours * 3600;   // ending no sooner than this
  const windowClose = nowSec + maxHours * 3600;  // ending no later than this

  try {
    const { data, error } = await supabase
      .from('auctions')
      .select('auction_id, title, timestamp_end, watchers, views, bid_count, comments')
      .gt('timestamp_end', windowOpen)
      .lte('timestamp_end', windowClose)
      .is('engagement_snapshot_at', null)
      .order('timestamp_end', { ascending: true })
      .limit(limit);

    if (error) {
      // The columns are the likeliest cause; say so rather than a bare PG error.
      const hint = /column .* does not exist/i.test(error.message)
        ? ' — run supabase_migration_engagement_snapshot.sql in the game project'
        : '';
      return NextResponse.json({ success: false, error: error.message + hint }, { status: 500 });
    }

    const candidates = data || [];
    // Nothing to latch is the normal case between windows, not a failure.
    const withStats = candidates.filter(
      (a) => a.watchers != null || a.views != null || a.bid_count != null
    );

    const results = { scanned: candidates.length, latched: 0, no_stats_yet: candidates.length - withStats.length, failed: 0 };
    const samples = [];

    if (!dryRun) {
      for (const a of withStats) {
        const hoursOut = a.timestamp_end ? (a.timestamp_end - nowSec) / 3600 : null;
        const { error: upErr } = await supabase
          .from('auctions')
          .update({
            watchers_at_48h: a.watchers ?? null,
            views_at_48h: a.views ?? null,
            bid_count_at_48h: a.bid_count ?? null,
            comments_at_48h: a.comments ?? null,
            engagement_snapshot_at: new Date().toISOString(),
          })
          // Re-assert the latch so two overlapping cron runs cannot both write.
          .eq('auction_id', a.auction_id)
          .is('engagement_snapshot_at', null);

        if (upErr) {
          results.failed += 1;
          continue;
        }
        results.latched += 1;
        if (samples.length < 10) {
          samples.push({
            auction_id: a.auction_id,
            title: a.title ? String(a.title).slice(0, 60) : null,
            watchers: a.watchers ?? null,
            hours_before_end: hoursOut != null ? Math.round(hoursOut * 10) / 10 : null,
          });
        }
      }
    } else {
      results.latched = withStats.length;
      withStats.slice(0, 10).forEach((a) => samples.push({
        auction_id: a.auction_id,
        title: a.title ? String(a.title).slice(0, 60) : null,
        watchers: a.watchers ?? null,
        hours_before_end: a.timestamp_end ? Math.round(((a.timestamp_end - nowSec) / 3600) * 10) / 10 : null,
      }));
    }

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      window: { min_hours: minHours, max_hours: maxHours },
      ...results,
      samples,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
