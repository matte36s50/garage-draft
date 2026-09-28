import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalRpc } from '../../../../../lib/canonicalStore';
import { fetchEvent, fetchEventLots, lotSummary, rpcErrorMessage } from '../../../../../lib/storeSales';
import { matchLots } from '../../../../../lib/lotMatch';

/**
 * POST /api/store/sales/merge — fold one event into another (same sale
 * entered twice, or a typo'd name).
 *
 * Body { from, into }            -> preview: proposed same-car pairs (with a
 *                                   confidence each), lots that will move as
 *                                   they are, and lots only in the target.
 * Body { from, into, pairs, apply: true }
 *                                -> merge, with exactly the pairs the admin
 *                                   ticked ([{ keep, drop }], keep in `into`,
 *                                   drop in `from`). auction_merge_events
 *                                   validates every pair and runs as one
 *                                   transaction.
 */

const MAX_PAIRS = 2000;

export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { from, into } = body;
  if (!from || !into) return NextResponse.json({ error: 'from and into are required' }, { status: 400 });
  if (from === into) return NextResponse.json({ error: 'Pick two different events' }, { status: 400 });

  if (body.apply) {
    const pairs = Array.isArray(body.pairs) ? body.pairs : [];
    if (pairs.length > MAX_PAIRS || pairs.some((p) => !p || typeof p.keep !== 'string' || typeof p.drop !== 'string')) {
      return NextResponse.json({ error: 'pairs must be a list of { keep, drop } listing ids' }, { status: 400 });
    }
    const res = await canonicalRpc('auction_merge_events', {
      p_from: from,
      p_into: into,
      p_pairs: pairs.map((p) => ({ keep: p.keep, drop: p.drop })),
    });
    if (!res.ok) return NextResponse.json({ error: rpcErrorMessage(res) }, { status: res.status >= 500 ? res.status : 400 });
    return NextResponse.json({ success: true, ...res.data });
  }

  const [evFrom, evInto, lotsFrom, lotsInto] = await Promise.all([
    fetchEvent(from), fetchEvent(into), fetchEventLots(from), fetchEventLots(into),
  ]);
  for (const r of [evFrom, evInto, lotsFrom, lotsInto]) {
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 502 });
  }

  const m = matchLots(lotsInto.rows, lotsFrom.rows);
  return NextResponse.json({
    from: evFrom.event,
    into: evInto.event,
    pairs: m.matches.map((x) => ({
      keep: lotSummary(x.existing),
      drop: lotSummary(x.incoming),
      score: x.score,
      via: x.via,
      confidence: x.confidence,
    })),
    move: m.unmatchedIncoming.map(lotSummary),
    into_only: m.unmatchedExisting.length,
  });
}
