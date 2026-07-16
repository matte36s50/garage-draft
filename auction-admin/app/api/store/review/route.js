import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalGet, canonicalRpc } from '../../../../lib/canonicalStore';

/** GET /api/store/review — the needs_review queue, oldest first. */
export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const res = await canonicalGet(
    'auction_listings_all?select=*&needs_review=is.true&order=created_at.asc&limit=200',
    { count: true }
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ rows: res.rows, total: res.total });
}

/**
 * POST /api/store/review — resolve a queue item.
 *
 * Body, one of:
 *   { action: 'assign',  canonical_model_id, make, model, trim? }
 *       Registers the alias for the listing's raw strings and retroactively
 *       claims every unassigned listing matching it (auction_add_model_alias).
 *   { action: 'create_and_assign', bucket: {make, model, generation?, year_min?, year_max?},
 *     make, model, trim? }
 *       Creates the bucket first, then assigns as above.
 *   { action: 'dismiss', listing_id }
 *       Clears needs_review without assigning (e.g. currency reviews).
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

  if (body.action === 'dismiss') {
    if (!body.listing_id) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
    const res = await canonicalRpc('auction_set_review', {
      p_listing_id: body.listing_id, p_needs_review: false,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ success: true });
  }

  if (body.action === 'assign' || body.action === 'create_and_assign') {
    if (!body.make || !body.model) {
      return NextResponse.json({ error: 'make and model (the listing raw strings) are required' }, { status: 400 });
    }

    let bucketId = body.canonical_model_id;
    if (body.action === 'create_and_assign') {
      const b = body.bucket || {};
      if (!b.make || !b.model) {
        return NextResponse.json({ error: 'bucket.make and bucket.model are required' }, { status: 400 });
      }
      const created = await canonicalRpc('auction_create_canonical_model', {
        p_make: b.make, p_model: b.model, p_generation: b.generation || null,
        p_year_min: b.year_min != null && b.year_min !== '' ? parseInt(b.year_min, 10) : null,
        p_year_max: b.year_max != null && b.year_max !== '' ? parseInt(b.year_max, 10) : null,
      });
      if (!created.ok) return NextResponse.json({ error: created.error }, { status: created.status });
      bucketId = created.data;
    }
    if (!bucketId) return NextResponse.json({ error: 'canonical_model_id required' }, { status: 400 });

    const res = await canonicalRpc('auction_add_model_alias', {
      p_make: body.make, p_model: body.model, p_trim: body.trim || null,
      p_canonical_model_id: bucketId,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ success: true, canonical_model_id: bucketId, claimed: res.data });
  }

  return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
}
