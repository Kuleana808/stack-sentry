import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Refreshes the Supabase session cookie on every request, and keeps signed-out
 * visitors out of the app surfaces.
 *
 * This is a convenience gate, not the security boundary — RLS is. A request
 * that slipped past here still cannot read another tenant's rows.
 */
const PROTECTED = ['/dashboard', '/integrations', '/repairs', '/settings', '/admin']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname, search } = request.nextUrl
  if (!user && PROTECTED.some((prefix) => pathname.startsWith(prefix))) {
    const loginUrl = new URL('/login', request.url)
    // Carry the query string, not just the path. The OAuth callback lands on
    // /dashboard?connect=…&reason=… and if the session is not live yet, dropping
    // the search would silently discard the outcome of the connect attempt.
    loginUrl.searchParams.set('next', `${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)'],
}
