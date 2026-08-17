import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalGet } from '../../../../../lib/canonicalStore';

/**
 * GET /api/store/analytics/pulse — market direction.
 *
 * Returns every (tier, period) row of auction_market_pulse; the tab splits
 * them into the pooled 'All tiers' series and the per-tier ones. The whole
 * view is a few dozen rows, so there is nothing to page.
 *
 * Needs supabase_migration_market_pulse.sql applied in the canonical project.
 */
export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const res = await canonicalGet(
    'auction_market_pulse?select=*&order=tier.asc,period.asc&limit=1000'
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({ rows: res.rows });
}
