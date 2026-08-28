import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabasePublicConfigured } from '@/lib/supabase/env'
import { safeNext } from '@stack-sentry/core'

/**
 * Magic-link landing. Exchanges the one-time code for a session cookie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeNext(url.searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }

  if (!isSupabasePublicConfigured()) {
    return NextResponse.redirect(new URL('/login?error=not_configured', url.origin))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', url.origin))
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
