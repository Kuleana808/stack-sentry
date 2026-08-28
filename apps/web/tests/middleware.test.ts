import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

const PUBLIC_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const

afterEach(() => {
  for (const name of PUBLIC_ENV) delete process.env[name]
})

function request(path: string) {
  return new NextRequest(new URL(path, 'https://stack-sentry.vercel.app'))
}

describe('middleware without Supabase env', () => {
  it('lets marketing through without inventing credentials', async () => {
    for (const path of ['/', '/pricing', '/about', '/book-a-call']) {
      const res = await middleware(request(path))
      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toBeNull()
    }
  })

  it('sends app surfaces to login', async () => {
    for (const path of [
      '/dashboard',
      '/dashboard/foo',
      '/integrations',
      '/repairs',
      '/settings',
      '/admin',
    ]) {
      const res = await middleware(request(`${path}?x=1`))
      expect(res.status).toBe(307)
      const loc = new URL(res.headers.get('location')!)
      expect(loc.pathname).toBe('/login')
      expect(loc.searchParams.get('next')).toBe(`${path}?x=1`)
    }
  })
})
