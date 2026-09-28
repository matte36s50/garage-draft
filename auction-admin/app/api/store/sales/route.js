import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalRpc } from '../../../../lib/canonicalStore';
import { listEventsWithStats, rpcErrorMessage } from '../../../../lib/storeSales';
import { suggestDuplicateEvents } from '../../../../lib/lotMatch';

/**
 * GET   /api/store/sales — every live-auction event with lot, result and
 *                          estimate counts, plus pairs that look like the same
 *                          sale entered twice.
 * PATCH /api/store/sales — rename an event or set its sale dates
 *                          ({ id, house, name, location, starts_on, ends_on }).
 *                          The old name keeps resolving to it (event_aliases).
 */

export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const res = await listEventsWithStats();
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  const suggestions = suggestDuplicateEvents(
    res.rows.map((e) => ({ ...e, first_date: e.sale_date }))
  ).map(({ from, into }) => ({ from: from.id, into: into.id }));

  return NextResponse.json({ rows: res.rows, suggestions });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  for (const f of ['starts_on', 'ends_on']) {
    if (body[f] && !DATE.test(body[f])) {
      return NextResponse.json({ error: `${f} must be YYYY-MM-DD` }, { status: 400 });
    }
  }

  const res = await canonicalRpc('auction_update_event', {
    p_event_id: body.id,
    p_house: body.house ?? null,
    p_name: body.name ?? null,
    p_location: body.location || null,
    p_starts_on: body.starts_on || null,
    p_ends_on: body.ends_on || null,
  });
  if (!res.ok) return NextResponse.json({ error: rpcErrorMessage(res) }, { status: res.status >= 500 ? res.status : 400 });
  return NextResponse.json({ success: true });
}
