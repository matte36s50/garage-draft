import { NextResponse } from 'next/server'
import { signingSecret, webSessionToken } from './lib/adminSession'

/**
 * Page gate for the admin panels.
 *
 * It used to let anyone through who had an `admin_auth` cookie of any value,
 * which a visitor can set by hand. It now checks the signed `admin_session`
 * cookie that /api/login issues, the same token verifyAdminRequest checks on
 * the API routes (lib/adminAuth.js). Middleware runs on the edge runtime, so
 * the HMAC is computed with Web Crypto (lib/adminSession.js).
 */

function sameString(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function middleware(request) {
  if (request.nextUrl.pathname === '/login') {
    return NextResponse.next()
  }

  const secret = signingSecret()
  // No secret configured: let local development through, as verifyAdminRequest does.
  if (!secret && process.env.NODE_ENV !== 'production') {
    return NextResponse.next()
  }

  const cookie = request.cookies.get('admin_session')?.value || ''
  if (secret && sameString(cookie, await webSessionToken(secret))) {
    return NextResponse.next()
  }

  const login = new URL('/login', request.url)
  login.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ['/', '/store'],
}
