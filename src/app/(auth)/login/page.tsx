import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { LoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'Sign in — Stack Sentry',
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center gap-2.5">
          <span aria-hidden className="relative flex h-2.5 w-2.5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary/40" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Stack Sentry</span>
        </Link>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your email and we will send you a link. No password to choose or remember.
        </p>

        {/* LoginForm reads the `next` search param, so the page bails out of
            static rendering without a boundary here. */}
        <Suspense fallback={<div className="mt-8 h-[9.5rem]" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
