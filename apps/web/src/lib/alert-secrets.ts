import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureCustomerDek } from '@stack-sentry/core/credentials'
import { sealToken, openToken } from '@stack-sentry/core/crypto'

/**
 * Slack webhook custody.
 *
 * A Slack incoming-webhook URL is a credential — anyone holding it can post into
 * the customer's workspace — so it gets the same treatment as an OAuth token:
 * sealed under the customer's own data key, never returned by any API, and only
 * ever unsealed server-side at send time.
 */

export async function sealForCustomer(
  admin: SupabaseClient,
  customerId: string,
  webhookUrl: string | null,
): Promise<void> {
  if (webhookUrl === null) {
    // Explicit removal. Keep the row so `key_id` history stays intact.
    const { error } = await admin
      .from('customer_alert_secrets')
      .update({ slack_webhook_enc: null, updated_at: new Date().toISOString() })
      .eq('customer_id', customerId)
    if (error) throw error
    return
  }

  const dek = await ensureCustomerDek(admin, customerId)

  const { error } = await admin.from('customer_alert_secrets').upsert(
    {
      customer_id: customerId,
      slack_webhook_enc: sealToken(dek, webhookUrl),
      key_id: dek.keyId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'customer_id' },
  )
  if (error) throw error
}

/** Unseal at send time only. Never returned to a client. */
export async function loadSlackWebhook(
  admin: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const [{ data: secret }, { data: key }] = await Promise.all([
    admin
      .from('customer_alert_secrets')
      .select('slack_webhook_enc')
      .eq('customer_id', customerId)
      .maybeSingle(),
    admin
      .from('customer_keys')
      .select('wrapped_dek, key_id')
      .eq('customer_id', customerId)
      .maybeSingle(),
  ])

  if (!secret?.slack_webhook_enc || !key) return null

  return openToken(
    { ciphertext: key.wrapped_dek as string, keyId: key.key_id as string },
    secret.slack_webhook_enc as string,
  )
}
