import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { env } from './lib/config'

const app = new Hono()

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: env.FRONTEND_ORIGIN ? [env.FRONTEND_ORIGIN] : '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  })
)

app.get('/', (c) => c.text('actik API'))
app.get('/health', (c) => c.json({ status: 'ok' }))

export default {
  port: 8000,
  fetch: app.fetch,
}
