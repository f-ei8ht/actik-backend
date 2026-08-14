import type { NpmPackageRaw, PypiPackageRaw } from './registry/registry'
import type {
  AdvisoryNode,
  ApplicationInput,
  ApplicationNode,
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
  applicationId,
  edgeId,
  maintainerId,
  packageId,
  packageVersionId,
} from './types'
import { testOsvAffected, type OsvAffected, type OsvVulnDoc } from './version'

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
  if (versionNodes.length === 0) return []
  const latestVersion = versionNodes.find((node) => node.version === raw.latest) ?? versionNodes[0]
  const source = latestVersion.id
  const names = new Set<string>()

  if ('versions' in raw) {
    const entry = raw.versions[raw.latest]
    if (entry) {
      for (const depName of Object.keys(entry.dependencies ?? {})) {
        if (depName) names.add(depName)
      }
    }
  } else {
    for (const dep of raw.requiresDist) {
      names.add(dep.name)
    }
  }

  return [...names].map((name) => ({ source, name }))
}

export function normalizeAdvisory(doc: OsvVulnDoc): AdvisoryNode {
  return {
    id: advisoryNodeId(doc.id),
    advisoryId: doc.id,
    severity: extractSeverity(doc),
    summary: doc.summary ?? doc.details ?? doc.id,
    publishedAt: doc.published ?? '',
    modifiedAt: doc.modified ?? '',
    references: (doc.references ?? []).map((ref) => ref.url ?? '').filter(Boolean).join('\n'),
  }
}

export interface NormalizedApplications {
  nodes: ApplicationNode[]
  edges: Edge[]
}

export function normalizeApplications(
  inputs: ApplicationInput[],
  versionIdByKey: Map<string, number>
): NormalizedApplications {
  const nodes: ApplicationNode[] = []
  const edges: Edge[] = []
  for (const input of inputs) {
    const node: ApplicationNode = {
      id: applicationId(input.name),
      name: input.name,
      repository: input.repository,
    }
    nodes.push(node)
    for (const pkg of input.packages) {
      const source = versionIdByKey.get(`${pkg.ecosystem}:${pkg.name}:${pkg.version}`)
      if (source === undefined) continue
      edges.push({
        id: edgeId('USED_BY', source, node.id),
        source,
        target: node.id,
      })
    }
  }
  return { nodes, edges }
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
