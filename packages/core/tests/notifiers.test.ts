import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sendEmail, sendSlack, sendSms, deliver } from '../src/notifiers'
import type { RenderedAlert } from '../src/alerting'

const alert: RenderedAlert = {
  subject: 'Shopify → Slack order alerts is failing',
  text: 'It failed 3 times in a row.',
  sms: 'Shopify order alerts failing.',
}

const saved = { ...process.env }

beforeEach(() => {
  for (const key of [
    'RESEND_API_KEY',
    'ALERT_FROM_EMAIL',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
  ]) {
    delete process.env[key]
  }
})

afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
})

const stubFetch = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl))

describe('email', () => {
  it('suppresses with no address on file', async () => {
    const result = await sendEmail(null, alert)
    expect(result).toMatchObject({ channel: 'email', status: 'suppressed' })
  })

  it('suppresses when Resend is not configured', async () => {
    const result = await sendEmail('owner@example.com', alert)
    expect(result.status).toBe('suppressed')
    expect(result.error).toMatch(/not configured/i)
  })

  it('sends and records the provider id', async () => {
    process.env.RESEND_API_KEY = 'key'
    process.env.ALERT_FROM_EMAIL = 'alerts@stacksentry.app'
    stubFetch(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }))

    const result = await sendEmail('owner@example.com', alert)
    expect(result).toMatchObject({ status: 'sent', destination: 'owner@example.com', providerId: 'msg_1' })
  })

  it('records a provider rejection as failed, not sent', async () => {
    process.env.RESEND_API_KEY = 'key'
    process.env.ALERT_FROM_EMAIL = 'alerts@stacksentry.app'
    stubFetch(async () => new Response('{}', { status: 422 }))

    const result = await sendEmail('owner@example.com', alert)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('422')
  })

  it('never throws when the network dies', async () => {
    process.env.RESEND_API_KEY = 'key'
    process.env.ALERT_FROM_EMAIL = 'alerts@stacksentry.app'
    stubFetch(async () => {
      throw new Error('ECONNRESET')
    })

    // A thrown send would abort the poll sweep for every remaining customer.
    await expect(sendEmail('owner@example.com', alert)).resolves.toMatchObject({ status: 'failed' })
  })
})

describe('slack', () => {
  it('suppresses with no webhook', async () => {
    expect(await sendSlack(null, alert)).toMatchObject({ status: 'suppressed' })
  })

  it('sends to the webhook', async () => {
    stubFetch(async () => new Response('ok', { status: 200 }))
    expect(await sendSlack('https://hooks.slack.com/x', alert)).toMatchObject({ status: 'sent' })
  })

  it('records a non-2xx as failed', async () => {
    stubFetch(async () => new Response('invalid_token', { status: 403 }))
    const result = await sendSlack('https://hooks.slack.com/x', alert)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('403')
  })
})

describe('sms', () => {
  it('is suppressed rather than failed while Twilio is dark', async () => {
    // Unconfigured is a business decision, not a fault. `failed` should mean
    // "we tried and could not".
    const result = await sendSms('+18085551234', alert)
    expect(result.status).toBe('suppressed')
    expect(result.error).toMatch(/not enabled/i)
  })

  it('sends once Twilio is configured', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC1'
    process.env.TWILIO_AUTH_TOKEN = 'tok'
    process.env.TWILIO_FROM_NUMBER = '+15005550006'
    stubFetch(async () => new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 }))

    expect(await sendSms('+18085551234', alert)).toMatchObject({ status: 'sent', providerId: 'SM1' })
  })
})

describe('deliver', () => {
  it('fans out to every requested channel and reports each independently', async () => {
    process.env.RESEND_API_KEY = 'key'
    process.env.ALERT_FROM_EMAIL = 'alerts@stacksentry.app'
    stubFetch(async () => new Response(JSON.stringify({ id: 'x' }), { status: 200 }))

    const results = await deliver(
      ['email', 'slack', 'sms'],
      { email: 'owner@example.com', sms: '+18085551234', slackWebhookUrl: 'https://hooks.slack.com/x' },
      alert,
    )

    expect(results).toHaveLength(3)
    expect(results.find((r) => r.channel === 'email')?.status).toBe('sent')
    expect(results.find((r) => r.channel === 'slack')?.status).toBe('sent')
    // SMS stays dark; one channel being off must not mark the others failed.
    expect(results.find((r) => r.channel === 'sms')?.status).toBe('suppressed')
  })

  it('does not reject when one channel blows up', async () => {
    process.env.RESEND_API_KEY = 'key'
    process.env.ALERT_FROM_EMAIL = 'alerts@stacksentry.app'
    stubFetch(async () => {
      throw new Error('network gone')
    })

    const results = await deliver(['email', 'slack'], { email: 'a@b.co', slackWebhookUrl: 'https://x' }, alert)
    expect(results.every((r) => r.status === 'failed')).toBe(true)
  })
})
