import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Book a call — Stack Sentry',
  description:
    'Twenty minutes. Bring your automations and we will tell you where they are most likely to break.',
}

/**
 * TODO(PR #5): swap the mailto for an embedded scheduler once Brent picks one.
 * Cal.com's free tier is the default candidate — no spend, self-hostable later.
 * Until then a real inbox beats a booking widget that nobody is watching.
 */
const CONTACT_EMAIL = 'hello@stacksentry.app'

export default function BookACallPage() {
  return (
    <div className="container py-20">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        Twenty minutes, and you will know where your stack is fragile.
      </h1>

      <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
        Bring the automations your business depends on. We will walk through what breaks most often
        in stacks that look like yours, and what the repair window would actually cover.
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Button asChild size="lg">
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Stack Sentry — book a call')}&body=${encodeURIComponent(
              'What we automate:\n\nPlatforms we use (Zapier / Make / n8n / other):\n\nBest times for a 20-minute call:\n',
            )}`}
          >
            Email us to book
          </a>
        </Button>
        <span className="text-sm text-muted-foreground">
          Or skip the call —{' '}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            connect Zapier
          </Link>{' '}
          and see your stack health in five minutes.
        </span>
      </div>

      <dl className="mt-16 grid max-w-3xl gap-8 sm:grid-cols-3">
        {[
          ['No prep needed', 'You do not have to document anything first. We read the stack with you on the call.'],
          ['No pitch deck', 'We look at your automations and tell you which are most likely to fail.'],
          ['No obligation', 'If monitoring is not worth it for your stack, we will say so.'],
        ].map(([term, detail]) => (
          <div key={term}>
            <dt className="font-medium">{term}</dt>
            <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
