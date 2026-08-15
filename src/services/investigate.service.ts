import { computeBlastRadius } from '../analysis/blast-radius'
import { getAdvisoriesForVersion } from './advisory.service'
import { getMaintainerRisk, getSharedMaintainers } from './maintainer.service'
import { getTyposquatCandidates } from './typosquat.service'
import { getVersionDetails } from './package.service'
import type { Ecosystem } from '../ingestion/types'

export interface InvestigateResult {
  package: string
  version: string
  ecosystem: string
  versionDetails: Awaited<ReturnType<typeof getVersionDetails>>
  advisories: Awaited<ReturnType<typeof getAdvisoriesForVersion>>
  blastRadius: Awaited<ReturnType<typeof computeBlastRadius>> | null
  maintainerRisk: Awaited<ReturnType<typeof getMaintainerRisk>>
  sharedMaintainers: Awaited<ReturnType<typeof getSharedMaintainers>>
  typosquats: Awaited<ReturnType<typeof getTyposquatCandidates>>
  recommendations: string[]
}

/**
 * The single entry point for a security investigation of a package version:
 * advisories, blast radius, affected repositories, maintainer reach, typo
 * squats and remediation — everything the frontend needs in one call.
 */
export async function investigate(
  name: string,
  version: string,
  ecosystem?: Ecosystem
): Promise<InvestigateResult> {
  const [versionDetails, advisories, blastRadius, maintainerRisk, sharedMaintainers, typosquats] =
    await Promise.all([
      getVersionDetails(name, version, ecosystem),
      getAdvisoriesForVersion(name, version, ecosystem),
      computeBlastRadius(name, version, ecosystem),
      getMaintainerRisk(name, ecosystem),
      getSharedMaintainers(name, ecosystem),
      getTyposquatCandidates(name),
    ])

  const recommendations: string[] = []
  for (const advisory of advisories) {
    const fix = advisory.fixedVersions[name]
    recommendations.push(
      fix
        ? `Upgrade ${name} ${version} -> ${fix} (${advisory.id})`
        : `Review advisory ${advisory.id} — no known fixed version`
    )
  }
  if (blastRadius && blastRadius.affectedRepositories.length > 0) {
    recommendations.push(
      `Blast radius: ${blastRadius.affectedRepositories.length} repository(ies) resolve affected versions`
    )
  }
  if (maintainerRisk.presentInRepositories > 0) {
    recommendations.push(
      `Maintainer reach: ${maintainerRisk.presentInRepositories} of ${maintainerRisk.totalPackages} shared-maintainer package(s) appear in repositories`
    )
  }
  const strongTyposquat = typosquats.filter((candidate) => (candidate.similarity ?? 0) >= 0.9)
  if (strongTyposquat.length > 0) {
    recommendations.push(`Possible typosquats nearby: ${strongTyposquat.map((c) => c.name).join(', ')}`)
  }

  return {
    package: name,
    version,
    ecosystem: ecosystem ?? '',
    versionDetails,
    advisories,
    blastRadius,
    maintainerRisk,
    sharedMaintainers,
    typosquats,
    recommendations,
  }
}
