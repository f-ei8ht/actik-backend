import { Hono } from 'hono'
import { z } from 'zod'
import { hydra } from '../hydra/client'
import { seedEdgesQuery, seedNodesQuery } from '../hydra/queries'
import { getDependencyGraph } from '../services/graph.service'

const app = new Hono()

const demoNodes = [
  { id: 1, name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
  { id: 2, name: 'express', version: '4.18.2', ecosystem: 'npm' },
  { id: 3, name: 'next', version: '14.0.0', ecosystem: 'npm' },
  { id: 4, name: 'hono', version: '4.13.1', ecosystem: 'npm' },
]

const demoEdges = [
  { id: 101, source: 2, target: 1 },
  { id: 102, source: 3, target: 2 },
  { id: 103, source: 4, target: 1 },
]

app.post('/seed', async (c) => {
  await hydra.query(seedNodesQuery, { parameters: { nodes: demoNodes } })
  await hydra.query(seedEdgesQuery, { parameters: { edges: demoEdges } })
  return c.json({ ok: true, nodes: demoNodes.length, edges: demoEdges.length })
})

const nameSchema = z.string().min(1).max(200).regex(/^[@a-zA-Z0-9._~/-]+$/)
const versionSchema = z.string().min(1).max(100)

app.get('/:name/:version', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  return c.json(await getDependencyGraph(name, version))
})

export default app
