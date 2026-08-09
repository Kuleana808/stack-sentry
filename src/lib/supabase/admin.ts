import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Reach for this ONLY where RLS deliberately has no policy and the operation is
 * genuinely system-owned: reading `connection_secrets`, unwrapping a customer
 * DEK, writing `llm_router_audit`, stamping a repair approval. Never behind a
 * route that takes a customer-supplied id without an ownership check first.
 *
 * `server-only` makes it a build error to import this from a client component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
