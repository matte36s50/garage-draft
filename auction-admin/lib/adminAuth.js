import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

/**
 * Server-side admin authentication helpers.
 *
 * Two ways to authorize a request:
 *   1. Admin session cookie `admin_session` — issued by POST /api/login after a
 *      successful password check. The cookie value is an HMAC the server can
 *      verify (it is NOT a guessable constant like the old `admin_auth=true`).
 *   2. Cron secret — `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`,
 *      so the same routes can be driven by external automation/cron.
 *
 * The signing secret is derived from (in order): ADMIN_SECRET, ADMIN_PASSWORD,
 * NEXT_PUBLIC_ADMIN_PASSWORD. Existing deployments that only set
 * NEXT_PUBLIC_ADMIN_PASSWORD keep working with no extra config.
 */

export const ADMIN_SESSION_COOKIE = 'admin_session';

function signingSecret() {
  return (
    process.env.ADMIN_SECRET ||
    process.env.ADMIN_PASSWORD ||
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD ||
    ''
  );
}

/** Deterministic session token derived from the signing secret. */
export function adminSessionToken() {
  const secret = signingSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update('bidprix-admin-session-v1').digest('hex');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function hasValidCronSecret(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = request.headers.get('authorization');
  const secretParam = new URL(request.url).searchParams.get('secret');
  return (
    safeEqual(authHeader || '', `Bearer ${cronSecret}`) || safeEqual(secretParam || '', cronSecret)
  );
}

function hasValidAdminSession(request) {
  const expected = adminSessionToken();
  if (!expected) return false;
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return safeEqual(cookie || '', expected);
}

/**
 * Returns a NextResponse (401/503) if the request is NOT authorized, or null if it is.
 * Usage:  const denied = verifyAdminRequest(request); if (denied) return denied;
 */
export function verifyAdminRequest(request) {
  // No secret configured at all: fail closed in production, allow in dev so the
  // app is still usable locally before env vars are set.
  if (!signingSecret() && !process.env.CRON_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Admin auth is not configured (set ADMIN_PASSWORD or CRON_SECRET)' },
        { status: 503 }
      );
    }
    return null;
  }

  if (hasValidAdminSession(request) || hasValidCronSecret(request)) {
    return null;
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
