import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { getBlastRadius } from '../services/blast-radius.service'
import type { Ecosystem } from '../ingestion/types'

const app = new Hono()

const nameSchema = z.string().min(1).max(200).regex(/^[@a-zA-Z0-9._~/-]+$/)
const versionSchema = z.string().min(1).max(100)
const ecosystemSchema = z.enum(['npm', 'PyPI'])

function ecosystemParam(c: Context): Ecosystem | undefined {
  const raw = c.req.query('ecosystem')
  return raw ? ecosystemSchema.parse(raw) : undefined
}

app.get('/:name/:version/blast-radius', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  return c.json(await getBlastRadius(name, version, ecosystemParam(c)))
})

export default app
