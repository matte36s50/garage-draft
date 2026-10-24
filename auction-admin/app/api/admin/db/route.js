import { NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/adminAuth';
import { runChain, validateChain } from '@/lib/adminDb';
import { gameServiceClient } from '@/lib/serviceClient';

/**
 * POST /api/admin/db — run one of the admin panels' queries with the
 * service-role key.
 *
 * Body: { chain: [['from', [table]], [method, args], ...] }, as recorded by
 * lib/supabase.js. Returns { data, error, count, status } in the shape
 * supabase-js resolves to, so the panels read it unchanged.
 *
 * Auth: admin session or `Authorization: Bearer <CRON_SECRET>`.
 */
export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: 'Invalid JSON body' } }, { status: 400 });
  }

  try {
    validateChain(body?.chain);
  } catch (e) {
    return NextResponse.json({ error: { message: e.message } }, { status: 400 });
  }

  let client;
  try {
    client = gameServiceClient();
  } catch (e) {
    return NextResponse.json({ error: { message: e.message } }, { status: 503 });
  }

  try {
    return NextResponse.json(await runChain(client, body.chain));
  } catch (e) {
    return NextResponse.json({ error: { message: e.message } }, { status: 400 });
  }
}
