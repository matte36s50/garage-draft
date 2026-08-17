import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalGet, canonicalRpc } from '../../../../../lib/canonicalStore';

/**
 * GET /api/store/analytics/bucket — comparable-set analytics.
 *
 * Two shapes, one route:
 *
 *   (no params)          the bucket picker: every bucket with a trailing-12m
 *                        median, richest first. Reads the auction_bucket_medians
 *                        view (supabase_migration_bucket_medians.sql).
 *
 *   ?id=<uuid>&months=N  the drill-down for one bucket: headline medians, the
 *                        per-year and per-quarter series, and the underlying
 *                        lots — one call, via auction_bucket_detail().
 *
 * Both require the canonical store to be configured; canonicalGet/canonicalRpc
 * return a 503 with an actionable message when it isn't, which the panel shows.
 */

const MIN_MONTHS = 6;
const MAX_MONTHS = 120;

export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const p = new URL(request.url).searchParams;
  const id = p.get('id');

  if (!id) {
    // Picker. Buckets with no settled sales are still listed — an empty bucket
    // is a real answer ("nothing has sold yet"), not an error — but they sort
    // last so the useful ones are reachable without scrolling.
    const minSold = Math.max(parseInt(p.get('min_sold') || '0', 10) || 0, 0);
    const parts = [
      'select=bucket_id,make,model,generation,year_min,year_max,'
        + 'lots_12m,sold_12m,median_12m,p25_12m,p75_12m,sell_through_12m,change_pct_12m',
      'order=sold_12m.desc.nullslast,lots_12m.desc.nullslast',
      'limit=1000',
    ];
    if (minSold > 0) parts.push(`sold_12m=gte.${minSold}`);

    const res = await canonicalGet(`auction_bucket_medians?${parts.join('&')}`);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ rows: res.rows });
  }

  const months = Math.min(
    Math.max(parseInt(p.get('months') || '24', 10) || 24, MIN_MONTHS),
    MAX_MONTHS
  );

  const res = await canonicalRpc('auction_bucket_detail', {
    p_bucket_id: id,
    p_months: months,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  // A bucket id that matches nothing comes back with a null bucket rather than
  // an error row — say so plainly instead of rendering an empty chart.
  if (!res.data || !res.data.bucket) {
    return NextResponse.json({ error: 'No such bucket, or it has no settled lots in range' }, { status: 404 });
  }
  return NextResponse.json(res.data);
}
