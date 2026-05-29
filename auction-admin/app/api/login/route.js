import { NextResponse } from 'next/server';
import { adminSessionToken, ADMIN_SESSION_COOKIE } from '../../../lib/adminAuth';

/**
 * Server-side admin login. The password is checked here (server-side) instead of
 * in the browser, and on success we set:
 *   - `admin_session` (httpOnly) — verified by API routes via verifyAdminRequest
 *   - `admin_auth=true`           — kept for the existing page middleware
 */
export async function POST(request) {
  let password = '';
  try {
    const body = await request.json();
    password = body?.password || '';
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const expected = process.env.ADMIN_PASSWORD || process.env.NEXT_PUBLIC_ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: 'Admin password is not configured' }, { status: 503 });
  }

  if (password !== expected) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const token = adminSessionToken();
  if (!token) {
    return NextResponse.json({ error: 'Admin auth is not configured' }, { status: 503 });
  }

  const res = NextResponse.json({ success: true });
  const cookieOpts = {
    path: '/',
    maxAge: 86400,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  };
  res.cookies.set(ADMIN_SESSION_COOKIE, token, { ...cookieOpts, httpOnly: true });
  // Non-httpOnly marker for the existing presence-based page middleware.
  res.cookies.set('admin_auth', 'true', cookieOpts);
  return res;
}
