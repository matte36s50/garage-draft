import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalGet } from '../../../../lib/canonicalStore';

/** GET /api/store/events — live-auction events with per-event lot counts. */
export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const res = await canonicalGet(
    'auction_events_all?select=*&order=created_at.desc&limit=200'
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ rows: res.rows });
}
