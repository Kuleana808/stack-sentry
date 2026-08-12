import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@stack-sentry/core/supabase'
import { ConnectButton } from './connect-button'

/**
 * Customer #1 setup path.
 *
 * The point is time-to-first-real-data, so this shows exactly what is done,
 * what is missing, and the one action to take next — rather than a wizard that
 * hides which step is actually blocked.
 *
 * Anything not configured is reported as missing. Nothing here is stubbed with
 * placeholder data: a green check that does not correspond to working
 * infrastructure is worse than a red one.
 */
export default async function DogfoodPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/dogfood')

  const checks = await runChecks(user.id)
  const blocked = checks.find((check) => !check.ok)

  return (
    <div className="container max-w-3xl py-16">
      <p className="font-mono text-sm uppercase tracking-widest text-primary">Internal</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Connect your own stack</h1>
      <p className="mt-3 text-muted-foreground">
        Signed in as <span className="text-foreground">{user.email}</span>. Target is real data
        flowing in under five minutes.
      </p>

      <ol className="mt-10 space-y-3">
        {checks.map((check, index) => (
          <li
            key={check.label}
            className={`rounded-lg border p-5 ${
              check.ok ? 'border-border' : 'border-state-degraded/50 bg-state-degraded/5'
            }`}
          >
            <div className="flex items-start gap-4">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  check.ok
                    ? 'bg-state-healthy/15 text-state-healthy'
                    : 'bg-state-degraded/15 text-state-degraded'
                }`}
                aria-hidden
              >
                {check.ok ? '✓' : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{check.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{check.detail}</p>
                {check.fix && !check.ok && (
                  <pre className="mt-3 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                    {check.fix}
                  </pre>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10">
        {blocked ? (
          <p className="text-sm text-muted-foreground">
            Blocked on <span className="text-foreground">{blocked.label}</span>. Clear it and
            reload — the connect button unlocks once the environment is ready.
          </p>
        ) : (
          <ConnectButton />
        )}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Once connected, the poll runs every 5 minutes.{' '}
        <Link href="/dashboard" className="text-primary underline-offset-4 hover:underline">
          Stack health
        </Link>{' '}
        shows the first sync as soon as it lands.
      </p>
    </div>
  )
}

interface Check {
  label: string
  detail: string
  ok: boolean
  fix?: string
}

async function runChecks(userId: string): Promise<Check[]> {
  const checks: Check[] = []

  const hasStateSecret = Boolean(process.env.STACK_SENTRY_OAUTH_STATE_SECRET)
  const hasZapierApp = Boolean(process.env.ZAPIER_CLIENT_ID && process.env.ZAPIER_CLIENT_SECRET)
  const hasMasterKey = Boolean(process.env.STACK_SENTRY_MASTER_KEY)

  checks.push({
    label: 'Credential encryption key',
    detail: hasMasterKey
      ? 'STACK_SENTRY_MASTER_KEY is set. Tokens will be sealed before they touch the database.'
      : 'STACK_SENTRY_MASTER_KEY is missing. Connecting would have nowhere safe to put the token, so it is blocked.',
    ok: hasMasterKey,
    fix: 'openssl rand -base64 32   # then set STACK_SENTRY_MASTER_KEY=k1:<value>',
  })

  checks.push({
    label: 'OAuth state signing key',
    detail: hasStateSecret
      ? 'STACK_SENTRY_OAUTH_STATE_SECRET is set. The connect flow is CSRF-protected.'
      : 'STACK_SENTRY_OAUTH_STATE_SECRET is missing. The connect route refuses to start rather than run unprotected.',
    ok: hasStateSecret,
    fix: 'openssl rand -base64 32   # then set STACK_SENTRY_OAUTH_STATE_SECRET=<value>',
  })

  checks.push({
    label: 'Zapier OAuth application',
    detail: hasZapierApp
      ? 'Client credentials are present.'
      : 'ZAPIER_CLIENT_ID and ZAPIER_CLIENT_SECRET are missing. These come from the Zapier developer platform and cannot be faked.',
    ok: hasZapierApp,
    fix: 'ZAPIER_CLIENT_ID=…\nZAPIER_CLIENT_SECRET=…\nZAPIER_REDIRECT_URI=http://localhost:3000/api/integrations/zapier/callback',
  })

  let hasTenant = false
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('customer_members')
      .select('customer_id')
      .eq('user_id', userId)
      .maybeSingle()
    hasTenant = Boolean(data?.customer_id)
  } catch {
    hasTenant = false
  }

  checks.push({
    label: 'Customer record',
    detail: hasTenant
      ? 'You have a tenant. Connections will attach to it.'
      : 'No customer record yet. One is created by the Stripe webhook on first checkout — for dogfooding, insert a customers row and a customer_members row for your user id.',
    ok: hasTenant,
    fix: "insert into customers (name, plan) values ('Brent — dogfood', 'pro') returning id;\ninsert into customer_members (customer_id, user_id, role) values ('<id>', '<your-user-id>', 'owner');",
  })

  return checks
}
