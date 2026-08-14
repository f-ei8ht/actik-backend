import { hydra, rowsToObjects } from '../hydra/client'
import { blastRadiusQuery, lookupPackageIdQuery, resolutionsForVersionQuery } from '../hydra/queries'
import { summarizePaths, type PropagationPath, type AffectedVersion } from './paths'

export interface ResolutionEvidence {
  repository: string
  lockfile: string
  commitSha: string
  requestedVersion: string
  resolvedVersion: string
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
  latencyMs: number
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

  const repositories = new Set<string>()
  const applications = new Set<string>()
  const resolutions: ResolutionEvidence[] = []
  for (const id of summary.affectedVersionIds) {
    const rows = rowsToObjects(
      await hydra.query(resolutionsForVersionQuery, {
        parameters: { id },
        consistency: 'causal',
      })
    )
    for (const row of rows) {
      const repository = String(row.repository)
      repositories.add(repository)
      if (String(row.kind) === 'application') applications.add(repository)
      resolutions.push({
        repository,
        lockfile: String(row.lockfile),
        commitSha: String(row.commitSha ?? ''),
        requestedVersion: String(row.requestedVersion ?? ''),
        resolvedVersion: String(row.resolvedVersion ?? ''),
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
    latencyMs: Math.round(latencyMs),
  }
}
