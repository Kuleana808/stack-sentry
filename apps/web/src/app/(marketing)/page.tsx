import Link from 'next/link'
import { PLANS, PLAN_ORDER } from '@stack-sentry/core'
import { PilotForm } from './pilot-form'
import { PricingStrip } from './pricing-strip'

/**
 * Landing page.
 *
 * ⚠️ CLAIMS REVIEW REQUIRED BEFORE THIS GOES LIVE ON A REAL DOMAIN.
 *
 * Two lines below promise more than the product currently does:
 *
 *   1. "Guaranteed repair within 2 hours" — automated repair is v0.2 and gated
 *      on data, and no consultant is staffed against a 2-hour clock yet.
 *   2. "Zapier + Make + n8n" — only the Zapier adapter exists, and it is still
 *      `verified: false` pending real developer credentials.
 *
 * This is safe to have in the repo (nothing is deployed, the domain is not
 * bought) but must be either delivered or reworded before launch. Flagged in
 * docs/ROADMAP.md under open decisions.
 */

export default function HomePage() {
  return (
    <>
      <section className="container pb-16 pt-20 sm:pt-28">
        <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          We monitor and fix your Zaps
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
          24/7 watch on Zapier, Make and n8n. Alerts the moment something fails.
          Guaranteed repair within 2 hours. Flat monthly retainer.
        </p>

        <div className="mt-10 max-w-xl">
          <PilotForm />
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Built by Brent Akamine · dogfooded on my own stack before anyone else&apos;s
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
          Because an alert tells you something broke. It does not tell you what to change, it
          does not watch the other three platforms your business runs on, and nobody at Zapier
          is on the hook for getting it working again.
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
    title: 'Accountability',
    body: 'A native alert fires into an inbox nobody owns. We carry a repair window, and every incident records whether we hit it. You can hold us to a number.',
  },
  {
    title: 'Cross-platform',
    body: 'Most businesses run more than one automation tool. Zapier will never watch your Make scenarios or your n8n workflows. One dashboard covers all of them.',
  },
  {
    title: 'Someone actually fixes it',
    body: 'Knowing a field got renamed is not the same as having it fixed. Fix hours are included in the retainer — you are not hiring a consultant every time something breaks.',
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
