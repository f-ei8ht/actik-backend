import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { ZodError } from 'zod'
import { env } from './lib/config'
import { AppError } from './lib/errors'
import { rateLimit } from './lib/rate-limit'
import packages from './routes/packages'
import advisories from './routes/advisories'
import graph from './routes/graph'

export const app = new Hono()

app.use('*', logger())
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
app.get('/health', (c) => c.json({ status: 'ok' }))

app.route('/api/packages', packages)
app.route('/api/advisories', advisories)
app.route('/api/graph', graph)

app.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status)
  }
  if (error instanceof ZodError) {
    return c.json(
      { error: { code: 'invalid_request', message: 'invalid path parameters' } },
      400
    )
  }
  console.error('unhandled error:', error)
  return c.json({ error: { code: 'internal', message: 'internal server error' } }, 500)
})

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404))

export default {
  port: 8000,
  fetch: app.fetch,
}
