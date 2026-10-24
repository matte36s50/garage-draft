/**
 * The admin panels' Supabase client — a stand-in that runs every query on the
 * server.
 *
 * It mirrors the slice of the supabase-js API the panels use
 * (`supabase.from(table).select(...).eq(...)`, awaited for { data, error }),
 * but records the chain and sends it to /api/admin/db, which checks the admin
 * session and runs it with the service-role key (lib/adminDb.js). The panels'
 * code is unchanged; the anon key no longer writes anything.
 */
import { ALLOWED_METHODS } from './adminDb';

class AdminQuery {
  constructor(table) {
    this.chain = [['from', [table]]];
  }

  then(resolve, reject) {
    return run(this.chain).then(resolve, reject);
  }
}

for (const method of ALLOWED_METHODS) {
  AdminQuery.prototype[method] = function step(...args) {
    this.chain.push([method, args]);
    return this;
  };
}

async function run(chain) {
  let res;
  try {
    res = await fetch('/api/admin/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain }),
    });
  } catch (e) {
    return { data: null, error: { message: e.message || 'Network error' }, count: null };
  }
  if (res.status === 401) {
    // Admin session expired; the login page returns here via ?next= after re-auth.
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    return { data: null, error: { message: 'Session expired — sending you to the login page…' }, count: null };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.error) return { data: null, error: { message: `HTTP ${res.status}` }, count: null };
  return { data: body.data ?? null, error: body.error ?? null, count: body.count ?? null, status: body.status };
}

export const supabase = {
  from(table) {
    return new AdminQuery(table);
  },
};
