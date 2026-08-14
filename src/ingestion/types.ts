export type Ecosystem = 'npm' | 'PyPI'

export interface PackageNode {
  id: number
  name: string
  ecosystem: Ecosystem
}

export interface PackageVersionNode {
  id: number
  packageId: number
  name: string
  version: string
  ecosystem: Ecosystem
}

export interface MaintainerNode {
  id: number
  name: string
  ecosystem: Ecosystem
}

export interface AdvisoryNode {
  id: number
  advisoryId: string
  severity: string
  summary: string
  publishedAt: string
  modifiedAt: string
  references: string
}

export interface OrganizationNode {
  id: number
  name: string
}

export interface RepositoryNode {
  id: number
  name: string
  org: string
  language: string
  kind: string
}

export interface LockfileNode {
  id: number
  path: string
  ecosystem: Ecosystem
  repository: string
  commitSha: string
  kind: string
}

export interface ResolvedDependency {
  ecosystem: Ecosystem
  name: string
  requestedVersion?: string
  resolvedVersion: string
}

export interface RepoLockfileRef {
  path: string
  ecosystem: Ecosystem
}

export interface DemoRepo {
  name: string
  language: string
  kind: string
  lockfiles: RepoLockfileRef[]
}

export interface DemoOrgManifest {
  org: string
  commitSha: string
  repositories: DemoRepo[]
}

export interface ResolvesEdge extends Edge {
  requestedVersion: string
  resolvedVersion: string
  lockfilePath: string
  repository: string
  commitSha: string
}

export interface Edge {
  id: number
  source: number
  target: number
}

export interface DependencySpec {
  source: number
  name: string
}

export interface NormalizedPackage {
  packageNode: PackageNode
  versionNodes: PackageVersionNode[]
  hasVersionEdges: Edge[]
  maintainerNodes: MaintainerNode[]
  maintainerEdges: Edge[]
  dependencySpecs: DependencySpec[]
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n

export function hashString(input: string): number {
  let hash = FNV_OFFSET
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn
  }
  return Number(hash & 0x1fffffffffffffn)
}

export const packageId = (ecosystem: Ecosystem, name: string) =>
  hashString(`pkg:${ecosystem}:${name}`)

export const packageVersionId = (ecosystem: Ecosystem, name: string, version: string) =>
  hashString(`pkgv:${ecosystem}:${name}:${version}`)

export const maintainerId = (ecosystem: Ecosystem, name: string) =>
  hashString(`maint:${ecosystem}:${name}`)

export const advisoryNodeId = (advisoryId: string) => hashString(`adv:${advisoryId}`)

export const organizationId = (name: string) => hashString(`org:${name}`)

export const repositoryId = (org: string, name: string) => hashString(`repo:${org}:${name}`)

export const lockfileId = (repository: string, path: string) => hashString(`lockfile:${repository}:${path}`)

export const resolvesEdgeId = (lockfile: number, version: number, requested?: string) =>
  hashString(`resolves:${lockfile}:${version}:${requested ?? ''}`)

export const edgeId = (type: string, source: number, target: number) =>
  hashString(`edge:${type}:${source}:${target}`)
