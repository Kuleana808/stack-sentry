/**
 * `next` parameters arrive from URLs and are therefore attacker-controllable.
 * A crafted sign-in link must not be able to bounce a freshly-authenticated
 * user to another site, so only same-origin relative paths are honoured.
 */
export function safeNext(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback
  // Reject protocol-relative (`//evil.com`), absolute URLs, backslash tricks,
  // and anything that is not a plain rooted path.
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (/[\r\n\t]/.test(value)) return fallback
  return value
}
