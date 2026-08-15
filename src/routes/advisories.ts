import { Hono } from 'hono'
import { z } from 'zod'
import { getAdvisory } from '../services/advisory.service'
import { getExposureWindow } from '../services/exposure-window.service'

const app = new Hono()

const idSchema = z.string().min(1).max(200)

app.get('/:id', async (c) => {
  const id = idSchema.parse(c.req.param('id'))
  return c.json(await getAdvisory(id))
})

app.get('/:id/exposure-window', async (c) => {
  const id = idSchema.parse(c.req.param('id'))
  const asOf = c.req.query('asOf')
  return c.json(await getExposureWindow(id, asOf))
})

export default app
