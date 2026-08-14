import { computeBlastRadius } from '../analysis/blast-radius'
import { notFound } from '../lib/errors'

export async function getBlastRadius(name: string, version: string, ecosystem?: string) {
  const result = await computeBlastRadius(name, version, ecosystem)
  if (!result) throw notFound(`${name}@${version} not found`)
  return {
    package: { name, version, ecosystem: result.ecosystem },
    directDependents: result.directDependents.length,
    transitiveDependents: result.transitiveDependents.length,
    count: result.count,
    maxDepth: result.maxDepth,
    affectedRepositories: result.affectedRepositories.length,
    repositories: result.affectedRepositories,
    affectedApplications: result.applications.length,
    applications: result.applications,
    dependents: result.transitiveDependents,
    paths: result.paths,
    resolutions: result.resolutions,
    latencyMs: result.latencyMs,
  }
}
