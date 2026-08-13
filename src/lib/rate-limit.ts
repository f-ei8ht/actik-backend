import type { MiddlewareHandler } from 'hono'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function rateLimit(limit: number, windowMs: number): MiddlewareHandler {
  return async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
    const now = Date.now()
    const bucket = buckets.get(ip)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs })
    } else if (bucket.count >= limit) {
      return c.json({ error: { code: 'rate_limited', message: 'Too many requests' } }, 429)
    } else {
      bucket.count += 1
    }
    if (buckets.size > 10_000) buckets.clear()
    await next()
  }
}
