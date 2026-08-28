import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabasePublicEnv } from './env'

/**
 * Request-scoped client carrying the signed-in user's session. Every query made
 * through this client is subject to RLS — which is the point. Server code that
 * needs to bypass RLS must reach for `admin.ts` explicitly and say why.
 *
 * Throws only when called. Missing env must not fail `next build` or the
 * marketing surface; callers that run without credentials should check
 * `isSupabasePublicConfigured()` first.
 */
export async function createClient() {
  const env = getSupabasePublicEnv()
  if (!env) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set')
  }

  const cookieStore = await cookies()

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by middleware instead.
        }
      },
    },
  })
}
