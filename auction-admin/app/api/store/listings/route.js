import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { canonicalGet } from '../../../../lib/canonicalStore';

/**
 * GET /api/store/listings — browse the canonical auction store.
 *
 * Query params (all optional):
 *   status=live,upcoming | ended       comma list
 *   source=bat|carsandbids|manual
 *   outcome=sold|reserve_not_met|withdrawn|unknown
 *   q=<text>                           matches raw_title/make/model (ilike)
 *   from=YYYY-MM-DD, to=YYYY-MM-DD     ended_at range
 *   needs_review=true
 *   sort=ends_at|ended_at|price|created_at   dir=asc|desc
 *   limit (<=500), offset
 *
 * Powers the Live Board and Results Browser tabs.
 */
export async function GET(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  const p = new URL(request.url).searchParams;
  const parts = ['select=*'];

  const status = (p.get('status') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (status.length === 1) parts.push(`status=eq.${status[0]}`);
  else if (status.length > 1) parts.push(`status=in.(${status.join(',')})`);

  if (p.get('source')) parts.push(`source_id=eq.${encodeURIComponent(p.get('source'))}`);
  if (p.get('outcome')) parts.push(`outcome=eq.${encodeURIComponent(p.get('outcome'))}`);
  if (p.get('needs_review') === 'true') parts.push('needs_review=is.true');
  if (p.get('from')) parts.push(`ended_at=gte.${encodeURIComponent(p.get('from'))}`);
  if (p.get('to')) parts.push(`ended_at=lte.${encodeURIComponent(p.get('to'))}T23:59:59Z`);

  const q = p.get('q');
  if (q) {
    const safe = q.replace(/[(),*]/g, ' ').trim();
    if (safe) {
      const pat = encodeURIComponent(`*${safe}*`);
      parts.push(`or=(raw_title.ilike.${pat},make.ilike.${pat},model.ilike.${pat})`);
    }
  }

  const sortable = new Set(['ends_at', 'ended_at', 'price', 'created_at', 'views', 'current_bid']);
  const sort = sortable.has(p.get('sort')) ? p.get('sort') : 'created_at';
  const dir = p.get('dir') === 'asc' ? 'asc' : 'desc';
  parts.push(`order=${sort}.${dir}.nullslast`);

  const limit = Math.min(parseInt(p.get('limit') || '100', 10) || 100, 500);
  const offset = Math.max(parseInt(p.get('offset') || '0', 10) || 0, 0);
  parts.push(`limit=${limit}`, `offset=${offset}`);

  const res = await canonicalGet(`auction_listings_all?${parts.join('&')}`, { count: true });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ rows: res.rows, total: res.total, limit, offset });
}
