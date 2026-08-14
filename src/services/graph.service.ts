import { hydra, rowsToObjects } from '../hydra/client'
import {
  advisoriesForVersionQuery,
  dependenciesQuery,
  dependentsQuery,
  resolutionsForVersionQuery,
  versionDetailsQuery,
} from '../hydra/queries'
import { notFound } from '../lib/errors'

export interface GraphNode {
  id: string
  type: 'package' | 'advisory' | 'repository'
  label: string
  severity?: string
  ecosystem?: string
  version?: string
}

export interface GraphEdge {
  source: string
  target: string
  type: string
}

export interface DependencyGraph {
  root: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const versionId = (name: string, version: string) => `${name}@${version}`
const advisoryId = (id: string) => `advisory:${id}`
const repositoryId = (name: string) => `repository:${name}`

export async function getDependencyGraph(
  name: string,
  version: string,
  ecosystem?: string
): Promise<DependencyGraph> {
  const params = { name, version, ...(ecosystem ? { ecosystem } : {}) }
  const root = rowsToObjects(
    await hydra.query(versionDetailsQuery(ecosystem), {
      parameters: params,
      consistency: 'causal',
    })
  )
  if (root.length === 0) throw notFound(`${name}@${version} not found`)

  const [dependencies, dependents, advisories, resolutions] = await Promise.all([
    rowsToObjects(
      await hydra.query(dependenciesQuery(ecosystem), { parameters: params, consistency: 'causal' })
    ),
    rowsToObjects(
      await hydra.query(dependentsQuery(ecosystem), { parameters: params, consistency: 'causal' })
    ),
    rowsToObjects(
      await hydra.query(advisoriesForVersionQuery(ecosystem), {
        parameters: params,
        consistency: 'causal',
      })
    ),
    rowsToObjects(
      await hydra.query(resolutionsForVersionQuery, {
        parameters: { id: Number(root[0].id) },
        consistency: 'causal',
      })
    ),
  ])

  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const rootId = versionId(name, version)
  nodes.set(rootId, { id: rootId, type: 'package', label: name, version, ecosystem: String(root[0].ecosystem) })

  for (const dependency of dependencies) {
    const depName = String(dependency.name)
    const depVersion = String(dependency.version)
    const id = versionId(depName, depVersion)
    if (!nodes.has(id)) {
      nodes.set(id, { id, type: 'package', label: depName, version: depVersion, ecosystem: String(dependency.ecosystem) })
    }
    edges.push({ source: rootId, target: id, type: 'depends_on' })
  }

  for (const dependent of dependents) {
    const depName = String(dependent.name)
    const depVersion = String(dependent.version)
    const id = versionId(depName, depVersion)
    if (!nodes.has(id)) {
      nodes.set(id, { id, type: 'package', label: depName, version: depVersion, ecosystem: String(dependent.ecosystem) })
    }
    edges.push({ source: id, target: rootId, type: 'depends_on' })
  }

  for (const advisory of advisories) {
    const id = advisoryId(String(advisory.id))
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        type: 'advisory',
        label: String(advisory.summary).slice(0, 60),
        severity: String(advisory.severity),
      })
    }
    edges.push({ source: rootId, target: id, type: 'affected_by' })
  }

  const repositories = new Map<string, string>()
  for (const resolution of resolutions) {
    repositories.set(String(resolution.repository), String(resolution.lockfile))
  }
  for (const [repository, lockfile] of [...repositories.entries()].sort()) {
    const id = repositoryId(repository)
    nodes.set(id, { id, type: 'repository', label: repository })
    edges.push({ source: id, target: rootId, type: 'resolves' })
    if (lockfile) {
      const lockId = `${id}/lockfile`
      nodes.set(lockId, { id: lockId, type: 'repository', label: lockfile })
      edges.push({ source: id, target: lockId, type: 'has_lockfile' })
    }
  }

  return { root: rootId, nodes: [...nodes.values()], edges }
}
