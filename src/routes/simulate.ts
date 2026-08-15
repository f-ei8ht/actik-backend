import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { simulatePropagation } from '../analysis/propagation'
import { notFound } from '../lib/errors'

const app = new Hono()

const nameSchema = z.string().min(1).max(200).regex(/^[@a-zA-Z0-9._~/-]+$/)
const versionSchema = z.string().min(1).max(100)
const ecosystemSchema = z.enum(['npm', 'PyPI'])

function queryParam(c: Context, key: string, fallback?: string): string | undefined {
  const raw = c.req.query(key)
  return raw ? raw : fallback
}

app.get('/propagation/:name/:version', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  const ecosystemRaw = c.req.query('ecosystem')
  const ecosystem = ecosystemRaw ? ecosystemSchema.parse(ecosystemRaw) : undefined

  const compromisedAt = queryParam(c, 'compromisedAt')
  const perHopMsRaw = queryParam(c, 'perHopMs')
  const maxDepthRaw = queryParam(c, 'maxDepth')

  const result = await simulatePropagation(name, version, ecosystem, {
    compromisedAt,
    perHopMs: perHopMsRaw ? z.coerce.number().int().positive().parse(perHopMsRaw) : undefined,
    maxDepth: maxDepthRaw ? z.coerce.number().int().positive().parse(maxDepthRaw) : undefined,
  })

  if (!result) throw notFound(`${name}@${version} not found`)
  return c.json(result)
})

export default app
