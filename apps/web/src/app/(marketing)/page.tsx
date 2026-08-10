import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { PLANS } from '@stack-sentry/core'
import { formatUsd } from '@/lib/utils'

export default function HomePage() {
  return (
    <>
      <section className="container pb-16 pt-20 sm:pt-28">
        <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          Your automations break at 2am. We fix them by breakfast.
        </h1>
        <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
          Stack Sentry watches every Zapier, Make, and n8n automation your business runs on. When
          one breaks, we find it, write the fix, and send it to you for a one-click approval —
          inside a repair window we put in writing.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Button asChild size="lg">
            <Link href="/login">Get started</Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            Connect Zapier and see your stack health in under five minutes.
          </span>
        </div>
      </section>

      {/* Show the product rather than describe it. */}
      <section className="container pb-24">
        <StackHealthPreview />
      </section>

      <section className="border-y border-border bg-muted/40">
        <div className="container py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
            What happens the moment something breaks
          </h2>
          <ol className="mt-12 grid gap-10 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <div className="font-mono text-sm text-primary">0{i + 1}</div>
                <h3 className="mt-3 text-lg font-medium">{step.title}</h3>
                <p className="mt-2 text-pretty leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container py-24">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">
              One number. One repair window.
            </h2>
            <p className="mt-3 max-w-md text-muted-foreground">
              Every plan includes monitoring, alerts, repair drafts, and the approval queue. The
              difference is how many automations you run and how fast we have to move.
            </p>
          </div>
          <Button asChild variant="outline" size="lg">
            <Link href="/pricing">See the three plans</Link>
          </Button>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {Object.values(PLANS).map((plan) => (
            <Link
              key={plan.id}
              href="/pricing"
              className="rounded-lg border border-border p-6 transition-colors hover:border-primary/60"
            >
              <div className="text-sm font-medium text-muted-foreground">{plan.name}</div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">
                {formatUsd(plan.monthly)}
                <span className="text-base font-normal text-muted-foreground">/mo</span>
              </div>
              <div className="mt-3 text-sm text-muted-foreground">
                {plan.stackLimit === null ? 'Unlimited automations' : `Up to ${plan.stackLimit} automations`}
                {' · '}
                {/* Forced by the plan-shape change: `slaHours` -> `responseTargetHours`.
                    v0.1 advertises a response target, matching incumbents; the
                    SLA-backed guarantee is v0.2, gated on data. Wording is
                    Codex's to finalise in the repositioning pass. */}
                {plan.responseTargetHours}-hour response target
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}

const STEPS = [
  {
    title: 'We catch it',
    body: 'Every automation is polled around the clock. A failed run raises an incident and starts the clock on your repair window — before a customer emails you about it.',
  },
  {
    title: 'We write the fix',
    body: 'The execution log goes to a repair agent that has seen this failure across every stack we monitor. You get a plain-English diagnosis and the specific change to make.',
  },
  {
    title: 'You approve it',
    body: 'One click from the alert. Nothing touches your account until you say yes — no autonomous edits to systems your business runs on.',
  },
]

/**
 * A static, honest picture of the dashboard. Not a claim about a specific
 * customer, and not a live widget pretending to be one.
 */
function StackHealthPreview() {
  const rows = [
    { name: 'Stripe → QuickBooks invoice sync', state: 'healthy', detail: '412 runs · 0 failed' },
    { name: 'Typeform → HubSpot lead intake', state: 'healthy', detail: '96 runs · 0 failed' },
    { name: 'Shopify → Slack order alerts', state: 'failing', detail: '3 failed · repair drafted' },
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
            <StatePill state={row.state} />
            <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
            <span className="hidden font-mono text-xs text-muted-foreground sm:block">
              {row.detail}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-border bg-muted/40 px-5 py-3.5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">1 repair awaiting your approval</span> — Shopify
        order alerts stopped after a field rename. Fix drafted 4 minutes ago.
      </div>
    </div>
  )
}

const STATE_STYLES = {
  healthy: 'bg-state-healthy',
  degraded: 'bg-state-degraded',
  failing: 'bg-state-failing',
} as const

function StatePill({ state }: { state: keyof typeof STATE_STYLES }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATE_STYLES[state]}`} />
      <span className="sr-only">{state}</span>
    </span>
  )
}
