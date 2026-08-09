import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Request-scoped client carrying the signed-in user's session. Every query made
 * through this client is subject to RLS — which is the point. Server code that
 * needs to bypass RLS must reach for `admin.ts` explicitly and say why.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
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
    },
  )
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}
