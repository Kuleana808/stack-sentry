import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { isSupabasePublicConfigured } from '@/lib/supabase/env'
import { createAdminClient } from '@stack-sentry/core/supabase'

/**
 * Platform-admin gate for the Brent-only surfaces.
 *
 * Membership in `platform_admins` is granted out of band — the table has no RLS
 * policies and no self-serve write path, so nobody can add themselves.
 *
 * The check runs the identity lookup through the user-scoped client (so the
 * session is real) and the membership lookup through the service role (because
 * `platform_admins` is deny-all). Doing the membership check with the user's own
 * client would silently return nothing and lock everyone out, including Brent.
 */
export interface AdminIdentity {
  userId: string
  email: string | null
}

export async function requireAdmin(): Promise<AdminIdentity | null> {
  if (!isSupabasePublicConfigured()) return null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return null
  }

  const { data, error } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return null

  return { userId: user.id, email: user.email ?? null }
}
