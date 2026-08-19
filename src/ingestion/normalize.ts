import type { NpmPackageRaw, PypiPackageRaw } from './registry/registry'
import type {
  AdvisoryNode,
  DependencySpec,
  Ecosystem,
  Edge,
  MaintainerNode,
  NormalizedPackage,
  PackageNode,
  PackageVersionNode,
} from './types'
import {
  advisoryNodeId,
  edgeId,
  maintainerId,
  packageId,
  packageVersionId,
} from './types'
import { firstFixedVersion, firstIntroducedVersion, testOsvAffected, type OsvAffected, type OsvVulnDoc } from './version'

export interface NormalizeOptions {
  pinnedVersions?: string[]
}

function pickEcosystem(name: string): Ecosystem {
  return name.toLowerCase() === 'pypi' ? 'PyPI' : (name as Ecosystem)
}

export function normalizePackage(
  ecosystem: Ecosystem,
  raw: NpmPackageRaw | PypiPackageRaw,
  options: NormalizeOptions = {}
): NormalizedPackage {
  const name = raw.name
  const pkgNode: PackageNode = { id: packageId(ecosystem, name), name, ecosystem }

  const selectedVersions = selectVersions(raw, options.pinnedVersions)
  const versionNodes: PackageVersionNode[] = selectedVersions.map((version) => ({
    id: packageVersionId(ecosystem, name, version),
    packageId: pkgNode.id,
    name,
    version,
    ecosystem,
  }))

  const hasVersionEdges: Edge[] = versionNodes.map((node) => ({
    id: edgeId('HAS_VERSION', pkgNode.id, node.id),
    source: pkgNode.id,
    target: node.id,
  }))

  const { maintainerNodes, maintainerEdges } = normalizeMaintainers(ecosystem, name, raw)

  return {
    packageNode: pkgNode,
    versionNodes,
    hasVersionEdges,
    maintainerNodes,
    maintainerEdges,
    dependencySpecs: dependencySpecs(ecosystem, raw, versionNodes),
  }
}

function selectVersions(
  raw: NpmPackageRaw | PypiPackageRaw,
  pinnedVersions: string[] | undefined
): string[] {
  const candidates = new Set<string>([raw.latest])
  if (Array.isArray(pinnedVersions)) {
    for (const version of pinnedVersions) {
      if (version) candidates.add(version)
    }
  }
  return [...candidates].filter(Boolean)
}

function normalizeMaintainers(
  ecosystem: Ecosystem,
  packageName: string,
  raw: NpmPackageRaw | PypiPackageRaw
): { maintainerNodes: MaintainerNode[]; maintainerEdges: Edge[] } {
  const names = new Set<string>()
  if ('maintainers' in raw) {
    for (const maintainer of raw.maintainers) {
      const name = (maintainer.name ?? maintainer.email ?? '').trim()
      if (name) names.add(name)
    }
  } else {
    for (const candidate of [raw.author, raw.maintainer, raw.authorEmail, raw.maintainerEmail]) {
      if (candidate && candidate.trim()) names.add(candidate.trim())
    }
  }

  const maintainerNodes: MaintainerNode[] = [...names].map((name) => ({
    id: maintainerId(ecosystem, name),
    name,
    ecosystem,
  }))
  const pkgId = packageId(ecosystem, packageName)
  const maintainerEdges: Edge[] = maintainerNodes.map((node) => ({
    id: edgeId('MAINTAINED_BY', pkgId, node.id),
    source: pkgId,
    target: node.id,
  }))
  return { maintainerNodes, maintainerEdges }
}

function dependencySpecs(
  ecosystem: Ecosystem,
  raw: NpmPackageRaw | PypiPackageRaw,
  versionNodes: PackageVersionNode[]
): DependencySpec[] {
  const specs: DependencySpec[] = []
  if ('versions' in raw) {
    for (const node of versionNodes) {
      const entry = raw.versions[node.version]
      if (!entry) continue
      for (const [depName, range] of Object.entries(entry.dependencies ?? {})) {
        if (depName) specs.push({ source: node.id, name: depName, range })
      }
    }
  } else {
    const latestNode = versionNodes.find((node) => node.version === raw.latest) ?? versionNodes[0]
    if (latestNode) {
      for (const dep of raw.requiresDist) {
        specs.push({ source: latestNode.id, name: dep.name, range: dep.specifier ?? undefined })
      }
    }
  }
  return specs
}

export function normalizeAdvisory(doc: OsvVulnDoc): AdvisoryNode {
  const fixedVersions: Record<string, string> = {}
  const introducedVersions: Record<string, string> = {}
  for (const affected of doc.affected ?? []) {
    const name = affected.package?.name
    if (!name) continue
    const fixed = firstFixedVersion(affected)
    if (fixed) fixedVersions[name] = fixed
    const introduced = firstIntroducedVersion(affected)
    if (introduced) introducedVersions[name] = introduced
  }
  return {
    id: advisoryNodeId(doc.id),
    advisoryId: doc.id,
    severity: extractSeverity(doc),
    summary: doc.summary ?? doc.details ?? doc.id,
    publishedAt: doc.published ?? '',
    modifiedAt: doc.modified ?? '',
    references: (doc.references ?? []).map((ref) => ref.url ?? '').filter(Boolean).join('\n'),
    fixedVersions: Object.keys(fixedVersions).length === 0 ? '' : JSON.stringify(fixedVersions),
    introducedVersions: Object.keys(introducedVersions).length === 0 ? '' : JSON.stringify(introducedVersions),
  }
}

function extractSeverity(doc: OsvVulnDoc): string {
  const databaseSeverity = (doc.database_specific as { severity?: string } | undefined)?.severity
  if (databaseSeverity) return databaseSeverity.toUpperCase()
  const firstScore = doc.severity?.[0]?.score
  const score = typeof firstScore === 'number' ? firstScore : Number(firstScore)
  if (!Number.isNaN(score)) {
    if (score >= 9.0) return 'CRITICAL'
    if (score >= 7.0) return 'HIGH'
    if (score >= 4.0) return 'MODERATE'
    return 'LOW'
  }
  return 'UNKNOWN'
}

export function affectedPackages(doc: OsvVulnDoc): Array<{ ecosystem: Ecosystem; name: string }> {
  const packages = new Map<string, { ecosystem: Ecosystem; name: string }>()
  for (const affected of doc.affected ?? []) {
    const name = affected.package?.name
    if (!name) continue
    const ecosystem = pickEcosystem(affected.package?.ecosystem ?? '')
    const key = `${ecosystem}:${name}`
    if (!packages.has(key)) packages.set(key, { ecosystem, name })
  }
  return [...packages.values()]
}

export function versionIsAffected(affected: OsvAffected, version: string): boolean {
  return testOsvAffected(affected, version)
}

export function isAffectedVersion(doc: OsvVulnDoc, ecosystem: Ecosystem, name: string, version: string): boolean {
  return (doc.affected ?? []).some(
    (affected) =>
      affected.package?.name === name &&
      pickEcosystem(affected.package?.ecosystem ?? '') === ecosystem &&
      versionIsAffected(affected, version)
  )
}
