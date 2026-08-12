import Link from 'next/link'
import { PLANS, PLAN_ORDER } from '@stack-sentry/core'
import { PilotForm } from './pilot-form'
import { PricingStrip } from './pricing-strip'

/**
 * Landing page.
 *
 * Every claim here is one v0.1 can actually keep:
 *   - Zapier only. Make and n8n are named as coming, never as shipping.
 *   - Detection speed, not repair speed. The 5-minute number is the poll
 *     interval, which is real. A repair-time promise is not, so it is absent.
 *   - "We help you fix it" — accountable, and true of a human on a retainer.
 *     Automated repair is v0.2 and gated on data; nothing here implies it.
 *
 * If a claim is added back, it needs to be one the product can keep on the day
 * the page ships, not the day we hope it will.
 */

export default function HomePage() {
  return (
    <>
      <section className="container pb-16 pt-20 sm:pt-28">
        <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          We watch your Zaps. When they break, we know first.
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
          24/7 monitoring on your Zapier automations. Email and SMS alerts within five
          minutes of a failure. Hands-on repair support in your first 24 hours. Flat monthly
          retainer.
        </p>

        <div className="mt-10 max-w-xl">
          <PilotForm />
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Zapier today · Make and n8n coming · Built by Brent Akamine, dogfooded on my own
          stack before anyone else&apos;s
        </p>
      </section>

      <section className="container pb-20">
        <StackHealthPreview />
      </section>

      <section className="border-y border-border bg-muted/40">
        <div className="container py-20">
          <h2 className="text-3xl font-semibold tracking-tight">One number a month</h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            Monitoring, alerts and fix hours are in every plan. What changes is how many
            automations we watch and how fast we move.
          </p>
          <PricingStrip />
          <p className="mt-6 text-sm text-muted-foreground">
            Beyond your included hours: {PLANS.starter.hourlyRate}–{PLANS.pro.hourlyRate}/hr
            depending on plan, or {PLANS.pro.emergencyRate}–{PLANS.starter.emergencyRate}/hr for
            drop-everything emergencies. Audits, migrations and consolidation reviews are
            available as one-offs.
          </p>
        </div>
      </section>

      {/* The objection that decides the sale. */}
      <section className="container py-20">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
          Why not just use Zapier&apos;s own alerts?
        </h2>
        <p className="mt-4 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
          Because a native alert tells you something broke, then stops. It lands in an inbox
          nobody owns, it does not tell you what to change, and nobody at Zapier is on the hook
          for getting you working again.
        </p>

        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {OBJECTION_ANSWERS.map((item) => (
            <div key={item.title}>
              <h3 className="text-lg font-medium">{item.title}</h3>
              <p className="mt-2 text-pretty leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-14">
          <Link
            href="#pilot"
            className="text-lg text-primary underline-offset-4 hover:underline"
          >
            Start a free 2-week pilot →
          </Link>
        </div>
      </section>
    </>
  )
}

const OBJECTION_ANSWERS = [
  {
    title: 'You hear it from us first',
    body: 'We poll every five minutes and alert by email and SMS. You find out from us, not from a customer asking where their order went.',
  },
  {
    title: 'Someone actually helps',
    body: 'Knowing a field got renamed is not the same as having it fixed. Fix hours are included in the retainer, so you are not hiring a consultant every time something breaks.',
  },
  {
    title: 'A record you can point at',
    body: 'Every failure, every response and every fix is logged. When someone asks why orders stopped last Tuesday, the answer is on a page rather than in somebody\u2019s memory.',
  },
]

function StackHealthPreview() {
  const rows = [
    { name: 'Stripe → QuickBooks invoice sync', state: 'healthy', detail: '412 runs · 0 failed' },
    { name: 'Typeform → HubSpot lead intake', state: 'healthy', detail: '96 runs · 0 failed' },
    { name: 'Shopify → Slack order alerts', state: 'failing', detail: '3 failed · fix in progress' },
    { name: 'Calendly → Gmail follow-up', state: 'healthy', detail: '38 runs · 0 failed' },
    { name: 'Airtable → Mailchimp sync', state: 'degraded', detail: '1 failed · watching' },
  ] as const

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <span className="text-sm font-medium">Stack health</span>
        <span className="font-mono text-xs text-muted-foreground">last 24 hours</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-4 px-5 py-3.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${STATE_STYLES[row.state]}`}
              aria-hidden
            />
            <span className="sr-only">{row.state}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
            <span className="hidden font-mono text-xs text-muted-foreground sm:block">
              {row.detail}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-border bg-muted/40 px-5 py-3.5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Shopify order alerts</span> — stopped after a
        field rename. Caught 4 minutes ago, fix underway.
      </div>
    </div>
  )
}

const STATE_STYLES = {
  healthy: 'bg-state-healthy',
  degraded: 'bg-state-degraded',
  failing: 'bg-state-failing',
} as const

export const PLAN_IDS = PLAN_ORDER
