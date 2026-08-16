import { Hono } from 'hono'
import { z } from 'zod'
import { investigate } from '../services/investigate.service'
import type { Ecosystem } from '../ingestion/types'

const app = new Hono()

const nameSchema = z.string().min(1).max(200).regex(/^[@a-zA-Z0-9._~/-]+$/)
const versionSchema = z.string().min(1).max(100)
const ecosystemSchema = z.enum(['npm', 'PyPI'])

app.get('/:ecosystem/:name/:version', async (c) => {
  const ecosystem = ecosystemSchema.parse(c.req.param('ecosystem'))
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  return c.json(await investigate(name, version, ecosystem as Ecosystem))
})

app.get('/:ecosystem/:name', async (c) => {
  const ecosystem = ecosystemSchema.parse(c.req.param('ecosystem'))
  const name = nameSchema.parse(c.req.param('name'))
  return c.json(await investigate(name, '', ecosystem as Ecosystem))
})

app.get('/:name/:version', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  return c.json(await investigate(name, version))
})

app.get('/:name', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  return c.json(await investigate(name, ''))
})

export default app
