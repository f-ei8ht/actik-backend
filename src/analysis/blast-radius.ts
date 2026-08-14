import { hydra, rowsToObjects } from '../hydra/client'
import {
  applicationsUsingVersionQuery,
  blastRadiusQuery,
  lookupPackageIdQuery,
} from '../hydra/queries'
import { summarizePaths, type PropagationPath, type AffectedVersion } from './paths'

export interface BlastRadiusResult {
  directDependents: AffectedVersion[]
  transitiveDependents: AffectedVersion[]
  maxDepth: number
  count: number
  paths: PropagationPath[]
  affectedApplications: string[]
  latencyMs: number
}

export async function resolveVersionId(name: string, version: string): Promise<number | null> {
  const response = await hydra.query(lookupPackageIdQuery, {
    parameters: { name, version },
    consistency: 'causal',
  })
  const rows = rowsToObjects(response)
  return rows.length ? Number(rows[0].id) : null
}

export async function computeBlastRadius(
  name: string,
  version: string,
  maxDepth = 10,
  maxPaths = 100
): Promise<BlastRadiusResult | null> {
  const source = await resolveVersionId(name, version)
  if (source === null) return null

  const startedAt = performance.now()
  const response = await hydra.query(blastRadiusQuery(maxDepth), {
    parameters: { source },
    consistency: 'causal',
  })
  const latencyMs = performance.now() - startedAt

  const summary = summarizePaths(response.rows, source, maxPaths)

  const applications = new Set<string>()
  for (const id of summary.affectedVersionIds) {
    const rows = rowsToObjects(
      await hydra.query(applicationsUsingVersionQuery, {
        parameters: { id },
        consistency: 'causal',
      })
    )
    for (const row of rows) applications.add(String(row.name))
  }

  return {
    directDependents: summary.directDependents,
    transitiveDependents: summary.transitiveDependents,
    maxDepth: summary.maxDepth,
    count: summary.transitiveDependents.length,
    paths: summary.paths,
    affectedApplications: [...applications].sort(),
    latencyMs: Math.round(latencyMs),
  }
}
