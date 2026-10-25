/**
 * The admin session token's ingredients, shared by the API routes
 * (lib/adminAuth.js, node:crypto) and the page middleware (middleware.js, Web
 * Crypto on the edge runtime), so the two can never sign differently.
 */

export const ADMIN_SESSION_MESSAGE = 'bidprix-admin-session-v1';

/**
 * The signing secret is derived from (in order): ADMIN_SECRET, ADMIN_PASSWORD,
 * NEXT_PUBLIC_ADMIN_PASSWORD. Existing deployments that only set
 * NEXT_PUBLIC_ADMIN_PASSWORD keep working with no extra config.
 */
export function signingSecret() {
  return (
    process.env.ADMIN_SECRET ||
    process.env.ADMIN_PASSWORD ||
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD ||
    ''
  );
}

/** The session token computed with Web Crypto, for code that can't use node:crypto. */
export async function webSessionToken(secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(ADMIN_SESSION_MESSAGE));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}
