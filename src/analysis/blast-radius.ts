import { hydra, rowsToObjects, decodeValue, type Path } from '../hydra/client'
import { blastRadiusQuery, lookupPackageIdQuery, resolutionsForVersionQuery } from '../hydra/queries'
import { summarizePaths, type PropagationPath, type AffectedVersion } from './paths'
import type { QueryResponse } from '../hydra/schema'

export interface ResolutionEvidence {
  repository: string
  lockfile: string
  commitSha: string
  requestedVersion: string
  resolvedVersion: string
  internalPath: string
}

export interface RepositoryExposurePath {
  repository: string
  lockfile: string
  internalPath: string
  /** package chain from the app's resolved version down to the compromised one */
  path: string[]
  depth: number
}

export interface BlastRadiusResult {
  ecosystem: string
  directDependents: AffectedVersion[]
  transitiveDependents: AffectedVersion[]
  maxDepth: number
  count: number
  paths: PropagationPath[]
  affectedRepositories: string[]
  applications: string[]
  resolutions: ResolutionEvidence[]
  repositoryPaths: RepositoryExposurePath[]
  latencyMs: number
}

function collectVersionPaths(
  rows: QueryResponse['rows'],
  sourceId: number
): { byId: Map<number, PropagationPath>; labelById: Map<number, string> } {
  const byId = new Map<number, PropagationPath>()
  const labelById = new Map<number, string>()
  for (const row of rows) {
    const path = decodeValue(row[0]) as Path
    const nodes = path.nodes
    for (const node of nodes) {
      const props = node.properties as Record<string, unknown>
      labelById.set(node.id, `${props.name}@${props.version}`)
    }
    const source = nodes[0]
    if (!source || source.id !== sourceId) continue
    for (let i = 1; i < nodes.length; i++) {
      const node = nodes[i]
      const depth = i
      const chain = nodes
        .slice(0, i + 1)
        .reverse()
        .map((n) => {
          const props = n.properties as Record<string, unknown>
          return `${props.name}@${props.version}`
        })
      const existing = byId.get(node.id)
      if (!existing || depth < existing.depth) byId.set(node.id, { path: chain, depth })
    }
  }
  return { byId, labelById }
}

export async function resolveVersionId(
  name: string,
  version: string,
  ecosystem?: string
): Promise<number | null> {
  const response = await hydra.query(lookupPackageIdQuery(ecosystem), {
    parameters: { name, version, ...(ecosystem ? { ecosystem } : {}) },
    consistency: 'causal',
  })
  const rows = rowsToObjects(response)
  return rows.length ? Number(rows[0].id) : null
}

export async function computeBlastRadius(
  name: string,
  version: string,
  ecosystem?: string,
  maxDepth = 10,
  maxPaths = 100
): Promise<BlastRadiusResult | null> {
  const source = await resolveVersionId(name, version, ecosystem)
  if (source === null) return null

  const startedAt = performance.now()
  const response = await hydra.query(blastRadiusQuery(maxDepth), {
    parameters: { source },
    consistency: 'causal',
  })
  const latencyMs = performance.now() - startedAt

  const summary = summarizePaths(response.rows, source, maxPaths)
  const { byId: pathByVersion, labelById } = collectVersionPaths(response.rows, source)

  const repositories = new Set<string>()
  const applications = new Set<string>()
  const resolutions: ResolutionEvidence[] = []
  const repositoryPaths: RepositoryExposurePath[] = []
  for (const id of summary.affectedVersionIds) {
    const rows = rowsToObjects(
      await hydra.query(resolutionsForVersionQuery, {
        parameters: { id },
        consistency: 'causal',
      })
    )
    for (const row of rows) {
      const repository = String(row.repository)
      const lockfile = String(row.lockfile)
      repositories.add(repository)
      if (String(row.kind) === 'application') applications.add(repository)
      resolutions.push({
        repository,
        lockfile,
        commitSha: String(row.commitSha ?? ''),
        requestedVersion: String(row.requestedVersion ?? ''),
        resolvedVersion: String(row.resolvedVersion ?? ''),
        internalPath: String(row.internalPath ?? ''),
      })
      const chain = pathByVersion.get(id)
      repositoryPaths.push({
        repository,
        lockfile,
        internalPath: String(row.internalPath ?? ''),
        path: chain ? chain.path : [labelById.get(id) ?? `${String(row.resolvedVersion ?? '')}`],
        depth: chain?.depth ?? 0,
      })
    }
  }

  return {
    ecosystem: ecosystem ?? '',
    directDependents: summary.directDependents,
    transitiveDependents: summary.transitiveDependents,
    maxDepth: summary.maxDepth,
    count: summary.transitiveDependents.length,
    paths: summary.paths,
    affectedRepositories: [...repositories].sort(),
    applications: [...applications].sort(),
    resolutions: resolutions.sort((a, b) =>
      a.repository === b.repository ? a.lockfile.localeCompare(b.lockfile) : a.repository.localeCompare(b.repository)
    ),
    repositoryPaths: repositoryPaths.sort((a, b) =>
      a.repository === b.repository ? a.lockfile.localeCompare(b.lockfile) : a.repository.localeCompare(b.repository)
    ),
    latencyMs: Math.round(latencyMs),
  }
}
