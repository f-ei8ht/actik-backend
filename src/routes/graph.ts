import { Hono } from 'hono'
import { decodeValue, hydra, rowsToObjects, type Path } from '../hydra/client'
import {
  blastRadiusQuery,
  countDirectDependentsQuery,
  lookupPackageIdQuery,
  seedEdgesQuery,
  seedNodesQuery,
} from '../hydra/queries'

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

async function resolvePackageId(name: string, version: string): Promise<number | null> {
  const response = await hydra.query(lookupPackageIdQuery, {
    parameters: { name, version },
    consistency: 'causal',
  })
  const rows = rowsToObjects(response)
  return rows.length ? Number(rows[0].id) : null
}

app.get('/blast-radius/:name/:version', async (c) => {
  const name = c.req.param('name')
  const version = c.req.param('version')
  const source = await resolvePackageId(name, version)
  if (source === null) {
    return c.json({ package: { name, version }, dependents: [], count: 0 }, 404)
  }

  const response = await hydra.query(blastRadiusQuery(), {
    parameters: { source },
    consistency: 'causal',
  })
  const paths = response.rows.map((row) => decodeValue(row[0]) as Path)

  const seen = new Set<number>()
  const dependents: Record<string, unknown>[] = []
  for (const path of paths) {
    const target = path.nodes[path.nodes.length - 1]
    if (!target || target.id === source || seen.has(target.id)) continue
    seen.add(target.id)
    dependents.push(target.properties)
  }

  return c.json({
    package: { name, version },
    dependents,
    count: dependents.length,
  })
})

app.get('/count/:name/:version', async (c) => {
  const name = c.req.param('name')
  const version = c.req.param('version')
  const source = await resolvePackageId(name, version)
  if (source === null) {
    return c.json({ package: { name, version }, directDependents: 0 }, 404)
  }
  const response = await hydra.query(countDirectDependentsQuery, {
    parameters: { id: source },
    consistency: 'causal',
  })
  const rows = rowsToObjects(response)
  return c.json({
    package: { name, version },
    directDependents: Number(rows[0]?.count ?? 0),
  })
})

export default app
