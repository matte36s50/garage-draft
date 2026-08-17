/**
 * Browser-side fetch helper for the admin panels.
 *
 * Extracted from CanonicalStorePanel so every panel handles an expired admin
 * session the same way — one place that knows to bounce through /login and
 * come back, rather than each tab inventing its own 401 behaviour.
 */
export async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Admin session expired; the login page returns here via ?next= after re-auth.
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('Session expired — sending you to the login page…');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
