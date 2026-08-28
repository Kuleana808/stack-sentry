import { createBrowserClient } from '@supabase/ssr'
import { getSupabasePublicEnv } from './env'

export function createClient() {
  const env = getSupabasePublicEnv()
  if (!env) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set')
  }
  return createBrowserClient(env.url, env.anonKey)
}
