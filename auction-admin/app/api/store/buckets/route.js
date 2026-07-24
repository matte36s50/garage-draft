import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalGet, canonicalRpc } from '../../../../lib/canonicalStore';

/**
 * GET /api/store/buckets — canonical models with listing/alias volume.
 * With ?aliases_for=<bucket-id>: that bucket's aliases instead (alias,
 * listing_count), most-recently registered first.
 */
export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const aliasesFor = new URL(request.url).searchParams.get('aliases_for');
  if (aliasesFor) {
    const res = await canonicalGet(
      `auction_bucket_aliases?select=*&canonical_model_id=eq.${encodeURIComponent(aliasesFor)}&order=created_at.desc`
    );
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ rows: res.rows });
  }

  const res = await canonicalGet(
    'auction_buckets?select=*&order=listing_count.desc&limit=1000'
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ rows: res.rows });
}

/**
 * POST /api/store/buckets — create (or fetch) a bucket.
 * Body: { make, model, generation?, year_min?, year_max? }
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
  if (!body.make || !body.model) {
    return NextResponse.json({ error: 'make and model are required' }, { status: 400 });
  }

  const res = await canonicalRpc('auction_create_canonical_model', {
    p_make: body.make,
    p_model: body.model,
    p_generation: body.generation || null,
    p_year_min: body.year_min != null && body.year_min !== '' ? parseInt(body.year_min, 10) : null,
    p_year_max: body.year_max != null && body.year_max !== '' ? parseInt(body.year_max, 10) : null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, id: res.data });
}

/**
 * PATCH /api/store/buckets — edit a bucket in place.
 * Body: { id, make, model, generation?, year_min?, year_max? }
 * Fields are SET, not merged: an empty generation/year clears it.
 */
export async function PATCH(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.id || !body.make || !body.model) {
    return NextResponse.json({ error: 'id, make, and model are required' }, { status: 400 });
  }

  const res = await canonicalRpc('auction_update_canonical_model', {
    p_id: body.id,
    p_make: body.make,
    p_model: body.model,
    p_generation: body.generation || null,
    p_year_min: body.year_min != null && body.year_min !== '' ? parseInt(body.year_min, 10) : null,
    p_year_max: body.year_max != null && body.year_max !== '' ? parseInt(body.year_max, 10) : null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ success: true });
}
