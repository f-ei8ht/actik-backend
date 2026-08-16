import type { Context, MiddlewareHandler } from 'hono'
import { env } from './config'

interface SlidingWindow {
  timestamps: number[]
}

const MAX_KEYS = 50_000

/**
 * Resolve the client identity in a spoof-resistant way.
 *
 * We only trust `x-forwarded-for` when running behind a reverse proxy that
 * sets it (TRUST_PROXY). Otherwise the client could just set any header and
 * bypass the limit entirely.
 */
function clientKey(c: Context): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for')
    if (forwarded) return `fwd:${forwarded.split(',')[0].trim()}`
    const realIp = c.req.header('x-real-ip')
    if (realIp) return `ip:${realIp.trim()}`
  }
  // Bun server exposes the actual peer address; never trust client-set headers.
  const server = c.env?.server as { requestIP?: (req: Request) => { address: string } | null } | undefined
  const peer = server?.requestIP?.(c.req.raw)
  return `ip:${peer?.address ?? 'unknown'}`
}

/**
 * Sliding-window rate limiter with per-route tiers and RFC-6585 headers.
 *
 * Returns a 429 with a `Retry-After` header when the client exceeds the limit
 * within the window.
 */
export function rateLimit(limit: number, windowMs: number): MiddlewareHandler {
  const windows = new Map<string, SlidingWindow>()
  return async (c, next) => {
    const key = clientKey(c)
    const now = Date.now()
    const cutoff = now - windowMs

    const window = windows.get(key) ?? { timestamps: [] }
    window.timestamps = window.timestamps.filter((ts) => ts > cutoff)
    const remaining = Math.max(0, limit - window.timestamps.length)

    c.header('RateLimit-Limit', String(limit))
    c.header('RateLimit-Remaining', String(remaining))
    c.header('RateLimit-Window', String(Math.round(windowMs / 1000)))

    if (window.timestamps.length >= limit) {
      const oldest = window.timestamps[0]
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
      c.header('Retry-After', String(retryAfterSec))
      return c.json(
        { error: { code: 'rate_limited', message: 'Too many requests' } },
        429
      )
    }

    window.timestamps.push(now)
    windows.set(key, window)

    if (windows.size > MAX_KEYS) {
      for (const [k, w] of windows) {
        w.timestamps = w.timestamps.filter((ts) => ts > Date.now() - windowMs)
        if (w.timestamps.length === 0) windows.delete(k)
      }
    }

    await next()
  }
}
