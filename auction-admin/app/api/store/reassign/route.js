import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalRpc } from '../../../../lib/canonicalStore';

/**
 * POST /api/store/reassign — move ONE listing to a different bucket.
 * Body: { listing_id, canonical_model_id }  — null/absent bucket id sends the
 * listing back to the review queue instead.
 *
 * The store records the placement as human-touched (manual_fields), so
 * alias-level operations never drag the listing elsewhere afterwards.
 */
export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.listing_id) {
    return NextResponse.json({ error: 'listing_id is required' }, { status: 400 });
  }

  const res = await canonicalRpc('auction_reassign_listing', {
    p_listing_id: body.listing_id,
    p_canonical_model_id: body.canonical_model_id || null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ success: true });
}
