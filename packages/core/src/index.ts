/**
 * Client-safe barrel. Anything exported here must be importable from a React
 * client component — no `node:` builtins, no `server-only`, no service-role
 * credentials.
 *
 * Server-side pieces live behind explicit subpaths so a stray barrel import can
 * never drag them into a browser bundle:
 *   @stack-sentry/core/crypto    — token sealing (node:crypto)
 *   @stack-sentry/core/llm       — Ollama-first router
 *   @stack-sentry/core/supabase  — service-role client (server-only)
 */
export * from './contracts'
export * from './api-types'
export * from './plans'
export * from './redirect'
export * from './pagination'
export * from './detection'
export * from './providers/types'
