import Link from 'next/link'
import { Button } from '@/components/ui/button'

/**
 * Four nav items, one of which is the CTA. Every extra item is a decision the
 * visitor has to make, so the list does not grow.
 */
const NAV = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/book-a-call', label: 'Book a call' },
]

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5">
          <SentryMark />
          <span className="text-[15px] font-semibold tracking-tight">Stack Sentry</span>
        </Link>

        {/*
          Below `sm` the header is CTA-only: three links plus a button do not fit
          at 375px, and a hamburger would add a decision to reach three pages.
          The footer nav and the homepage's inline pricing link cover it. Revisit
          if mobile analytics show people hunting for pricing.
        */}
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground sm:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>

        <Button asChild size="sm">
          <Link href="/login">Get started</Link>
        </Button>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="container flex flex-col gap-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <SentryMark />
          <span>Stack Sentry</span>
        </div>
        <nav className="flex flex-wrap gap-x-7 gap-y-2">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ))}
          <Link href="/login" className="transition-colors hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  )
}

function SentryMark() {
  return (
    <span
      aria-hidden
      className="relative flex h-2.5 w-2.5 items-center justify-center"
    >
      <span className="absolute inline-flex h-full w-full rounded-full bg-primary/40" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
    </span>
  )
}
