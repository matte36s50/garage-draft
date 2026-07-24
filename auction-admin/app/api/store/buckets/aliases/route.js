import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalRpc } from '../../../../../lib/canonicalStore';

/**
 * POST /api/store/buckets/aliases — repoint an alias at a different bucket.
 * Body: { alias, canonical_model_id, move_listings? }
 * With move_listings, the listings attributed to the alias follow it (the
 * store skips trim-aliased rows and manual placements). Responds with how
 * many listings moved.
 *
 * DELETE /api/store/buckets/aliases — remove an alias.
 * Body: { alias }
 * Already-claimed listings keep their bucket; the raw string re-enters the
 * review queue next time a listing carries it.
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
  if (!body.alias || !body.canonical_model_id) {
    return NextResponse.json({ error: 'alias and canonical_model_id are required' }, { status: 400 });
  }

  const res = await canonicalRpc('auction_repoint_alias', {
    p_alias: body.alias,
    p_canonical_model_id: body.canonical_model_id,
    p_move_listings: Boolean(body.move_listings),
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, listings_moved: Number(res.data) || 0 });
}

export async function DELETE(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.alias) {
    return NextResponse.json({ error: 'alias is required' }, { status: 400 });
  }

  const res = await canonicalRpc('auction_delete_alias', { p_alias: body.alias });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ success: true });
}
