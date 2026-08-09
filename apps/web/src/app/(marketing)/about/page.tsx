import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'About — Stack Sentry',
  description:
    'Why Stack Sentry exists, how we handle your credentials, and why no repair is ever applied without your approval.',
}

export default function AboutPage() {
  return (
    <div className="container py-20">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        Somebody should be on the hook when your automations break.
      </h1>

      <div className="mt-10 max-w-2xl space-y-6 text-lg leading-relaxed text-muted-foreground">
        <p>
          A small business ends up running on a dozen automations nobody owns. They were set up
          once, by someone who has since moved on, and they work — until a field gets renamed, a
          token expires, or an API changes shape. Then orders stop reaching the warehouse and
          nobody notices for three days.
        </p>
        <p>
          The platforms will tell you a run failed. They will not tell you what to change, they
          will not tell you at 2am, and they are not on the hook for fixing it. That gap is the
          whole product.
        </p>
        <p className="text-foreground">
          We watch every automation, we write the fix, and we carry a repair window you can hold us
          to.
        </p>
      </div>

      <div className="mt-16 grid max-w-4xl gap-10 sm:grid-cols-2">
        <section>
          <h2 className="text-xl font-medium">How we hold your credentials</h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            We connect through scoped OAuth tokens — never your password. Each customer gets their
            own encryption key, and tokens are encrypted before they touch our database with a
            master key that is not stored there. A stolen database backup decrypts nothing.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-medium">Why you approve every repair</h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Our agent drafts the fix and explains its reasoning. You approve it. We apply it. There
            is no mode where software edits the systems your business runs on while you sleep — the
            database itself rejects a repair that has no approval on it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-medium">Every stack makes the next fix faster</h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Each failure and the fix that resolved it is recorded. When the same breakage appears
            on someone else&apos;s stack, the diagnosis is already written. The service gets
            sharper the longer it runs.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-medium">Who is behind it</h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Stack Sentry is built in Hawaii by a small team that runs its own business on the same
            automations. We are customer number one — the monitoring you get is the monitoring we
            rely on.
          </p>
        </section>
      </div>

      <div className="mt-16 flex flex-wrap gap-4">
        <Button asChild size="lg">
          <Link href="/login">Get started</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/book-a-call">Talk to us first</Link>
        </Button>
      </div>
    </div>
  )
}
