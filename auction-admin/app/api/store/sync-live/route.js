import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import {
  toCanonicalItem, canonicalUpsertListings, canonicalConfigured,
} from '../../../../lib/canonicalStore';

/**
 * POST /api/store/sync-live — mirror the game's not-yet-ended auctions into
 * the canonical auction store.
 *
 * WHY: live BaT auctions land in the game's `auctions` table via processes
 * that write to Supabase directly, so the canonical store's dual-write shim
 * never sees them — it only fires inside this app's ingest/finalize routes,
 * which all deal in ENDED listings. Result: an empty Live Board even while
 * the game is full of live auctions. This route closes that gap on demand
 * (the Live Board's "Sync from game" button) or on a schedule.
 *
 * GET is also supported with the usual cron auth (Bearer CRON_SECRET or
 * ?secret=) so it can be added to the same external cron service as
 * update-performance / finalize-auctions.
 */

export async function GET(request) { return sync(request); }
export async function POST(request) { return sync(request); }

async function sync(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  if (!canonicalConfigured()) {
    return NextResponse.json(
      { error: 'Canonical store not configured (set CANONICAL_SUPABASE_URL and CANONICAL_SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 503 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const now = Math.floor(Date.now() / 1000);
  const { data, error } = await supabase
    .from('auctions')
    .select('*')
    .gt('timestamp_end', now)
    .order('timestamp_end', { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data || []).map((row) => toCanonicalItem(row)).filter(Boolean);
  if (items.length === 0) {
    return NextResponse.json({ success: true, synced: 0, message: 'No live auctions in the game to sync' });
  }

  const res = await canonicalUpsertListings(items);
  if (res.ok === false) {
    return NextResponse.json({ error: `Canonical store write failed: ${res.error}` }, { status: 502 });
  }

  return NextResponse.json({ success: true, synced: items.length });
}
