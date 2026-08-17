import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalGet } from '../../../../../lib/canonicalStore';

/**
 * GET /api/store/analytics/live — live-sale results and the live-vs-online split.
 *
 * Returns both halves in one call; each is small (events number in the tens,
 * buckets with live presence in the hundreds at most), so paging would cost
 * more than it saved.
 *
 *   events  auction_event_results, newest sale first
 *   buckets auction_bucket_venue_split, restricted to buckets that actually
 *           have a live sale — the view also covers online-only buckets, which
 *           have nothing to compare and would be noise here.
 *
 * Needs supabase_migration_live_sales.sql applied in the canonical project.
 */
export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const events = await canonicalGet(
    'auction_event_results?select=*&order=sale_date.desc.nullslast&limit=200'
  );
  if (!events.ok) return NextResponse.json({ error: events.error }, { status: events.status });

  const buckets = await canonicalGet(
    'auction_bucket_venue_split?select=*&live_n=gte.1'
      + '&order=live_over_online.desc.nullslast,live_n.desc&limit=500'
  );
  if (!buckets.ok) return NextResponse.json({ error: buckets.error }, { status: buckets.status });

  return NextResponse.json({ events: events.rows, buckets: buckets.rows });
}
