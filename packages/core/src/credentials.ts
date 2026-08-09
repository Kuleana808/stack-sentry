import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createWrappedDek, sealToken, openToken, type Sealed } from './crypto/tokens'

/**
 * Credential custody, end to end.
 *
 * The only code that should ever touch `customer_keys` or `connection_secrets`.
 * Both tables run RLS with zero policies, so every call here requires a
 * service-role client — passing an RLS-scoped client silently returns nothing
 * rather than failing loudly, which is why the caller must be explicit.
 */

export interface ProviderTokens {
  accessToken: string
  refreshToken?: string | null
  expiresAt?: Date | null
}

/** Fetch this customer's wrapped data key, minting one on first use. */
export async function ensureCustomerDek(
  admin: SupabaseClient,
  customerId: string,
): Promise<Sealed> {
  const { data: existing, error } = await admin
    .from('customer_keys')
    .select('wrapped_dek, key_id')
    .eq('customer_id', customerId)
    .maybeSingle()

  if (error) throw error
  if (existing) return { ciphertext: existing.wrapped_dek, keyId: existing.key_id }

  const minted = createWrappedDek()
  const { error: insertError } = await admin
    .from('customer_keys')
    .insert({ customer_id: customerId, wrapped_dek: minted.ciphertext, key_id: minted.keyId })

  if (insertError) {
    // Lost a race against a concurrent connect. Re-read rather than overwriting:
    // clobbering a DEK would make every token already sealed under it
    // permanently unreadable.
    const { data: raced } = await admin
      .from('customer_keys')
      .select('wrapped_dek, key_id')
      .eq('customer_id', customerId)
      .maybeSingle()

    if (raced) return { ciphertext: raced.wrapped_dek, keyId: raced.key_id }
    throw insertError
  }

  return minted
}

/** Encrypt and persist provider tokens for a connection. */
export async function storeConnectionTokens(
  admin: SupabaseClient,
  args: { customerId: string; connectionId: string; tokens: ProviderTokens },
): Promise<void> {
  const dek = await ensureCustomerDek(admin, args.customerId)

  const { error } = await admin.from('connection_secrets').upsert(
    {
      connection_id: args.connectionId,
      access_token_enc: sealToken(dek, args.tokens.accessToken),
      refresh_token_enc: args.tokens.refreshToken
        ? sealToken(dek, args.tokens.refreshToken)
        : null,
      key_id: dek.keyId,
      expires_at: args.tokens.expiresAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'connection_id' },
  )

  if (error) throw error
}

/**
 * Decrypt provider tokens. Server-side, service-role, and only on the poll and
 * repair paths — never in anything that renders to a browser.
 */
export async function loadConnectionTokens(
  admin: SupabaseClient,
  args: { customerId: string; connectionId: string },
): Promise<ProviderTokens | null> {
  const { data, error } = await admin
    .from('connection_secrets')
    .select('access_token_enc, refresh_token_enc, key_id, expires_at')
    .eq('connection_id', args.connectionId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const { data: keyRow, error: keyError } = await admin
    .from('customer_keys')
    .select('wrapped_dek, key_id')
    .eq('customer_id', args.customerId)
    .maybeSingle()

  if (keyError) throw keyError
  if (!keyRow) throw new Error(`no data key for customer ${args.customerId}`)

  const dek: Sealed = { ciphertext: keyRow.wrapped_dek, keyId: keyRow.key_id }

  return {
    accessToken: openToken(dek, data.access_token_enc),
    refreshToken: data.refresh_token_enc ? openToken(dek, data.refresh_token_enc) : null,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
  }
}
