/**
 * Public Supabase env is required for auth, the dashboard, and session refresh.
 * Marketing pages must render without it, so every reader is optional at
 * module/build time and only fails at the request that actually needs a client.
 */
export function getSupabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export function isSupabasePublicConfigured(): boolean {
  return getSupabasePublicEnv() !== null
}

/** Convenience gate matching middleware — not a security boundary; RLS is. */
export const PROTECTED_PREFIXES = [
  '/dashboard',
  '/integrations',
  '/repairs',
  '/settings',
  '/admin',
] as const

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}
