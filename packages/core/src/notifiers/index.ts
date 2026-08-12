/**
 * Alert delivery.
 *
 * Each notifier answers three things: is it configured, can it send, and what
 * happened. None of them throw — a failed send is recorded as `failed` on the
 * alert row so the miss is visible, rather than raised into the poll sweep where
 * it would abort the remaining customers' checks.
 *
 * SMS is wired but dark: Twilio is pay-as-you-go and stays unconfigured until
 * there is revenue to justify it. Unconfigured is reported as `suppressed`, not
 * `failed` — the difference matters, because `failed` should mean "we tried and
 * could not", and a suppressed send is a business decision rather than a fault.
 */

import type { AlertChannel, AlertDeliveryStatus } from '../api-types'
import type { RenderedAlert } from '../alerting'

export interface DeliveryResult {
  channel: AlertChannel
  status: AlertDeliveryStatus
  destination: string | null
  providerId?: string | null
  error?: string | null
}

export interface DeliveryTargets {
  email?: string | null
  sms?: string | null
  slackWebhookUrl?: string | null
}

const TIMEOUT_MS = 8000

async function post(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
}

export async function sendEmail(
  to: string | null | undefined,
  alert: RenderedAlert,
): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.ALERT_FROM_EMAIL

  if (!to) return suppressed('email', null, 'No alert email on file.')
  if (!apiKey || !from) return suppressed('email', to, 'Resend is not configured.')

  try {
    const res = await post('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [to], subject: alert.subject, text: alert.text }),
    })

    if (!res.ok) return failed('email', to, `Resend returned ${res.status}`)

    const body = (await res.json().catch(() => ({}))) as { id?: string }
    return { channel: 'email', status: 'sent', destination: to, providerId: body.id ?? null }
  } catch (error) {
    return failed('email', to, message(error))
  }
}

export async function sendSlack(
  webhookUrl: string | null | undefined,
  alert: RenderedAlert,
): Promise<DeliveryResult> {
  if (!webhookUrl) return suppressed('slack', null, 'No Slack webhook configured.')

  try {
    const res = await post(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: alert.subject,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: truncate(alert.subject, 150) } },
          { type: 'section', text: { type: 'mrkdwn', text: truncate(alert.text, 2900) } },
        ],
      }),
    })

    // Slack returns 200 with the body "ok"; anything else is a real failure.
    if (!res.ok) return failed('slack', 'slack', `Slack returned ${res.status}`)
    return { channel: 'slack', status: 'sent', destination: 'slack', providerId: null }
  } catch (error) {
    return failed('slack', 'slack', message(error))
  }
}

export async function sendSms(
  to: string | null | undefined,
  alert: RenderedAlert,
): Promise<DeliveryResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER

  if (!to) return suppressed('sms', null, 'No alert number on file.')

  // Deliberately dark until revenue justifies the spend. Reported as suppressed
  // rather than failed: this is a business decision, not a fault.
  if (!sid || !token || !from) {
    return suppressed('sms', to, 'SMS is not enabled yet.')
  }

  try {
    const res = await post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      },
      body: new URLSearchParams({ To: to, From: from, Body: alert.sms }),
    })

    if (!res.ok) return failed('sms', to, `Twilio returned ${res.status}`)

    const body = (await res.json().catch(() => ({}))) as { sid?: string }
    return { channel: 'sms', status: 'sent', destination: to, providerId: body.sid ?? null }
  } catch (error) {
    return failed('sms', to, message(error))
  }
}

/** Fan out to every requested channel. Never rejects. */
export async function deliver(
  channels: AlertChannel[],
  targets: DeliveryTargets,
  alert: RenderedAlert,
): Promise<DeliveryResult[]> {
  return Promise.all(
    channels.map((channel) => {
      switch (channel) {
        case 'email':
          return sendEmail(targets.email, alert)
        case 'slack':
          return sendSlack(targets.slackWebhookUrl, alert)
        case 'sms':
          return sendSms(targets.sms, alert)
      }
    }),
  )
}

function suppressed(channel: AlertChannel, destination: string | null, why: string): DeliveryResult {
  return { channel, status: 'suppressed', destination, error: why }
}

function failed(channel: AlertChannel, destination: string | null, why: string): DeliveryResult {
  return { channel, status: 'failed', destination, error: why }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}
