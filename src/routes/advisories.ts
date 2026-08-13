import { Hono } from 'hono'
import { z } from 'zod'
import { getAdvisory } from '../services/advisory.service'

const app = new Hono()

const idSchema = z.string().min(1).max(200)

app.get('/:id', async (c) => {
  const id = idSchema.parse(c.req.param('id'))
  return c.json(await getAdvisory(id))
})

export default app
