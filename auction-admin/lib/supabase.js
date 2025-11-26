import { createClient } from '@supabase/supabase-js'

let cachedSupabase = null

export function getSupabase() {
  if (!cachedSupabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    cachedSupabase = createClient(supabaseUrl, supabaseAnonKey)
  }
  return cachedSupabase
}

// For backwards compatibility
export const supabase = new Proxy({}, {
  get(target, prop) {
    return getSupabase()[prop]
  }
})