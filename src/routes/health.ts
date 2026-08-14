import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.json({ status: 'ok' }))

export default app
