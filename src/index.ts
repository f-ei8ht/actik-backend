import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { ZodError } from 'zod'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { env } from './lib/config'
import { AppError } from './lib/errors'
import { log } from './lib/logger'
import { rateLimit } from './lib/rate-limit'
import packages from './routes/packages'
import advisories from './routes/advisories'
import blastRadius from './routes/blast-radius'
import graph from './routes/graph'
import health from './routes/health'

export const app = new Hono()

app.use('*', honoLogger())
app.use(
  '*',
  cors({
    origin: env.FRONTEND_ORIGIN ? [env.FRONTEND_ORIGIN] : '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  })
)
app.use('/api/*', rateLimit(120, 60_000))

app.get('/', (c) => c.text('actik API'))
app.route('/health', health)

app.route('/api/packages', packages)
app.route('/api/packages', blastRadius)
app.route('/api/advisories', advisories)
app.route('/api/graph', graph)

app.onError((error, c) => {
  if (error instanceof AppError) {
    log.warn('request failed', { code: error.code, status: error.status, message: error.message })
    return c.json({ error: { code: error.code, message: error.message } }, error.status as ContentfulStatusCode)
  }
  if (error instanceof ZodError) {
    log.warn('invalid request parameters', { issues: error.issues })
    return c.json(
      { error: { code: 'invalid_request', message: 'invalid path parameters' } },
      400
    )
  }
  log.error('unhandled error', { message: error instanceof Error ? error.message : String(error) })
  return c.json({ error: { code: 'internal', message: 'internal server error' } }, 500)
})

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404))

export default {
  port: 8000,
  fetch: app.fetch,
}
