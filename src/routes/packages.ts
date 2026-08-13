import { Hono } from 'hono'
import { z } from 'zod'
import { getBlastRadius } from '../services/blast-radius.service'
import { getDependencyGraph } from '../services/graph.service'
import { getMaintainers, getSharedMaintainers } from '../services/maintainer.service'
import { listVersions, getPackageOverview, getVersionDetails, getVersionRelationships } from '../services/package.service'
import { getAdvisoriesForVersion } from '../services/advisory.service'
import { getTyposquatCandidates } from '../services/typosquat.service'

const app = new Hono()

const nameSchema = z.string().min(1).max(200).regex(/^[@a-zA-Z0-9._~/-]+$/)
const versionSchema = z.string().min(1).max(100)

app.get('/:name', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const overview = await getPackageOverview(name)
  const versions = await listVersions(name)
  return c.json({
    name: overview.name,
    ecosystem: overview.ecosystem,
    versionCount: overview.versions,
    advisoryCount: overview.advisories,
    versions,
  })
})

app.get('/:name/maintainers', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const maintainers = await getMaintainers(name)
  return c.json({ package: name, maintainers })
})

app.get('/:name/shared-maintainers', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const shared = await getSharedMaintainers(name)
  return c.json({ package: name, shared })
})

app.get('/:name/typosquats', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const candidates = await getTyposquatCandidates(name)
  return c.json({ package: name, candidates })
})

app.get('/:name/:version', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  const details = await getVersionDetails(name, version)
  const advisories = await getAdvisoriesForVersion(name, version)
  return c.json({ ...details, advisories })
})

app.get('/:name/:version/dependencies', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  const { dependencies } = await getVersionRelationships(name, version)
  return c.json({ package: { name, version }, dependencies })
})

app.get('/:name/:version/dependents', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  const { dependents } = await getVersionRelationships(name, version)
  return c.json({ package: { name, version }, dependents })
})

app.get('/:name/:version/blast-radius', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  return c.json(await getBlastRadius(name, version))
})

app.get('/:name/:version/graph', async (c) => {
  const name = nameSchema.parse(c.req.param('name'))
  const version = versionSchema.parse(c.req.param('version'))
  return c.json(await getDependencyGraph(name, version))
})

export default app
