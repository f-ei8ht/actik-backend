import { computeBlastRadius } from '../analysis/blast-radius'
import { fetchOsvFindings } from '../analysis/osv-findings'
import { getAdvisoriesForVersion, type AdvisoryDetails } from './advisory.service'
import { getMaintainerRisk, getSharedMaintainers } from './maintainer.service'
import { getTyposquatCandidates } from './typosquat.service'
import { getVersionDetails, listVersions } from './package.service'
import { compareVersions } from '../ingestion/version'
import type { Ecosystem } from '../ingestion/types'
import type { ScanFinding } from '../analysis/exposure'

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

const EMPTY_RISK = {
  package: '',
  ecosystem: '',
  maintainers: [] as string[],
  controlledPackages: [] as Awaited<ReturnType<typeof getMaintainerRisk>>['controlledPackages'],
  totalPackages: 0,
  presentInRepositories: 0,
}

function osvToAdvisory(finding: ScanFinding): AdvisoryDetails {
  return {
    id: finding.advisory.id,
    severity: finding.severity,
    summary: finding.advisory.summary,
    publishedAt: finding.advisory.publishedAt,
    modifiedAt: finding.advisory.modifiedAt,
    references: finding.advisory.references,
    fixedVersions: finding.fixedVersion
      ? { [finding.package]: finding.fixedVersion }
      : {},
    introducedVersions: {},
    affectedVersions: [],
  }
}

/**
 * One-call investigation for a package version. Graph-backed parts (blast
 * radius, maintainers) degrade gracefully when the package isn't in the
 * ingested graph; advisories always fall back to a live Google OSV check so
 * any version can be investigated.
 */
export async function investigate(
  name: string,
  version: string,
  ecosystem?: Ecosystem
): Promise<InvestigateResult> {
  if (!version) {
    const versions = await listVersions(name, ecosystem)
    const sorted = versions.sort((a, b) => compareVersions(b, a))
    for (const candidate of sorted) {
      const advisories = await getAdvisoriesForVersion(name, candidate, ecosystem).catch(() => [])
      if (advisories.length > 0) {
        version = candidate
        break
      }
    }
    if (!version) version = sorted[0] ?? ''
  }

  let versionDetails: InvestigateResult['versionDetails']
  try {
    versionDetails = await getVersionDetails(name, version, ecosystem)
  } catch {
    versionDetails = { name, version, ecosystem: ecosystem ?? '' }
  }

  const [graphAdvisories, osvFindings, blastRadius, maintainerRisk, sharedMaintainers, typosquats] =
    await Promise.all([
      getAdvisoriesForVersion(name, version, ecosystem).catch(() => []),
      fetchOsvFindings(
        [{ ecosystem: ecosystem ?? 'npm', name, resolvedVersion: version, lockfilePath: '' }],
        name
      ),
      computeBlastRadius(name, version, ecosystem).catch(() => null),
      getMaintainerRisk(name, ecosystem).catch(() => EMPTY_RISK),
      getSharedMaintainers(name, ecosystem).catch(() => []),
      getTyposquatCandidates(name),
    ])

  const seen = new Set(graphAdvisories.map((advisory) => advisory.id))
  const advisories = [
    ...graphAdvisories,
    ...osvFindings
      .filter((finding) => !seen.has(finding.advisory.id))
      .map(osvToAdvisory),
  ]

  const recommendations: string[] = []
  for (const advisory of advisories) {
    const fix = advisory.fixedVersions[name]
    const introduced = advisory.introducedVersions[name]
    recommendations.push(
      fix
        ? `Upgrade ${name} ${version} -> ${fix} (${advisory.id})`
        : `Review advisory ${advisory.id}: no known fixed version`
    )
    if (introduced && compareVersions(version, introduced) >= 0) {
      recommendations.push(`${name} ${version} has been vulnerable since ${introduced} (${advisory.id})`)
    }
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
  const strongTyposquat = typosquats.filter((candidate) => candidate.risk >= 60)
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
