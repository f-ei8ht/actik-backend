import { computeBlastRadius } from '../analysis/blast-radius'
import { notFound } from '../lib/errors'

export async function getBlastRadius(name: string, version: string) {
  const result = await computeBlastRadius(name, version)
  if (!result) throw notFound(`${name}@${version} not found`)
  return {
    package: { name, version },
    directDependents: result.directDependents.length,
    transitiveDependents: result.transitiveDependents.length,
    count: result.count,
    maxDepth: result.maxDepth,
    dependents: result.transitiveDependents,
    paths: result.paths,
    latencyMs: result.latencyMs,
  }
}
