import { Hono } from 'hono'
import { z } from 'zod'
import { getBlastRadius } from '../services/blast-radius.service'

const app = new Hono()

const nameSchema = z.string().min(1).max(200).regex(/^[@a-zA-Z0-9._~/-]+$/)
const versionSchema = z.string().min(1).max(100)

app.get('/:name/:version/blast-radius', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  return c.json(await getBlastRadius(name, version))
})

export default app
