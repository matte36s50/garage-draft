import { createClient } from '@supabase/supabase-js';

/**
 * The game database's service-role key, for server routes only.
 *
 * Server routes used to fall back to the anon key when this was unset. Once
 * the database refuses anon writes (supabase_migration_lock_down_rls.sql),
 * that fallback would make every write affect zero rows without an error, so
 * a cron could report success while changing nothing. Failing loudly instead
 * makes a missing key show up in the cron service's history straight away.
 */
export function serviceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Add it to the Vercel project (Settings → Environment Variables).');
  }
  return key;
}

export function gameServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey());
}
