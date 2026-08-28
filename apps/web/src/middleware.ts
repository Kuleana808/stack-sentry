import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Session refresh + a convenience gate for app surfaces. RLS is the security
 * boundary; this only keeps signed-out visitors out of /dashboard and friends.
 *
 * Marketing (/, /pricing, /about, /book-a-call) is not in `matcher`. A missing
 * or invalid Supabase env must never 500 those pages.
 *
 * Read NEXT_PUBLIC_* as static property access so the Edge bundle inlines them.
 * Do not invent placeholder credentials.
 */
const PROTECTED = ['/dashboard', '/integrations', '/repairs', '/settings', '/admin'] as const

function isProtectedPath(pathname: string): boolean {
  return PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function supabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { pathname, search } = request.nextUrl

  const env = supabasePublicEnv()
  if (!env) {
    if (isProtectedPath(pathname)) return redirectToLogin(request, pathname, search)
    return response
  }

  try {
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
  } catch {
    if (isProtectedPath(pathname)) return redirectToLogin(request, pathname, search)
  }

  return response
}

function redirectToLogin(request: NextRequest, pathname: string, search: string) {
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/dashboard',
    '/dashboard/:path*',
    '/integrations',
    '/integrations/:path*',
    '/repairs',
    '/repairs/:path*',
    '/settings',
    '/settings/:path*',
    '/admin',
    '/admin/:path*',
  ],
}
