import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalGet } from '../../../../../lib/canonicalStore';

/**
 * GET /api/store/analytics/demand — does watcher count predict the result?
 *
 *   deciles   auction_watcher_deciles — outcome by watcher decile, deciles
 *             ranked within (price band, quarter)
 *   coverage  auction_watcher_coverage — the population behind it, and why
 *             each excluded group fell out
 *
 * Coverage is returned alongside rather than on request: the deciles are only
 * readable next to the sample they came from.
 *
 * Needs supabase_migration_watcher_signal.sql applied in the canonical project.
 */
export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const deciles = await canonicalGet('auction_watcher_deciles?select=*&order=decile.asc');
  if (!deciles.ok) return NextResponse.json({ error: deciles.error }, { status: deciles.status });

  const coverage = await canonicalGet('auction_watcher_coverage?select=*&limit=1');
  if (!coverage.ok) return NextResponse.json({ error: coverage.error }, { status: coverage.status });

  return NextResponse.json({
    deciles: deciles.rows,
    coverage: coverage.rows?.[0] || null,
  });
}
