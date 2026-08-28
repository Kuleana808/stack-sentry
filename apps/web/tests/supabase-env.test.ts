import { afterEach, describe, expect, it } from 'vitest'
import {
  getSupabasePublicEnv,
  isProtectedPath,
  isSupabasePublicConfigured,
} from '@/lib/supabase/env'

const PUBLIC_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const

afterEach(() => {
  for (const name of PUBLIC_ENV) delete process.env[name]
})

describe('getSupabasePublicEnv', () => {
  it('is absent when either public key is missing so marketing can boot', () => {
    expect(getSupabasePublicEnv()).toBeNull()
    expect(isSupabasePublicConfigured()).toBe(false)

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    expect(getSupabasePublicEnv()).toBeNull()
  })

  it('returns both values only when they are set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

    expect(getSupabasePublicEnv()).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'anon-key',
    })
    expect(isSupabasePublicConfigured()).toBe(true)
  })
})

describe('isProtectedPath', () => {
  it('matches app surfaces and leaves marketing public', () => {
    expect(isProtectedPath('/dashboard')).toBe(true)
    expect(isProtectedPath('/admin/pilots')).toBe(true)
    expect(isProtectedPath('/')).toBe(false)
    expect(isProtectedPath('/pricing')).toBe(false)
    expect(isProtectedPath('/about')).toBe(false)
    expect(isProtectedPath('/book-a-call')).toBe(false)
    expect(isProtectedPath('/login')).toBe(false)
  })
})
