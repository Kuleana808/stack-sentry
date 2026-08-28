import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicEnv, isProtectedPath } from '@/lib/supabase/env'

/**
 * Refreshes the Supabase session cookie on every request, and keeps signed-out
 * visitors out of the app surfaces.
 *
 * This is a convenience gate, not the security boundary — RLS is. A request
 * that slipped past here still cannot read another tenant's rows.
 *
 * When public Supabase env is absent (marketing-only deploy), skip the client
 * entirely so `/`, `/pricing`, `/about`, and `/book-a-call` still render.
 * Protected paths redirect to login rather than 500.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { pathname, search } = request.nextUrl

  const env = getSupabasePublicEnv()
  if (!env) {
    if (isProtectedPath(pathname)) {
      return redirectToLogin(request, pathname, search)
    }
    return response
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && isProtectedPath(pathname)) {
    return redirectToLogin(request, pathname, search)
  }

  return response
}

function redirectToLogin(request: NextRequest, pathname: string, search: string) {
  const loginUrl = new URL('/login', request.url)
  // Carry the query string, not just the path. The OAuth callback lands on
  // /dashboard?connect=…&reason=… and if the session is not live yet, dropping
  // the search would silently discard the outcome of the connect attempt.
  loginUrl.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)'],
}
