import { env } from '../lib/config'
import { fetchAdvisories } from './advisory'
import { GraphWriter } from './graph-writer'
import { loadDemoOrg, readLockfile } from './lockfile/demo-org'
import { parseLockfile } from './lockfile'
import { normalizePackage } from './normalize'
import { fetchRegistryPackage, type NpmPackageRaw, type PypiPackageRaw } from './registry'
import { NPM_SEEDS, PYPI_SEEDS, type SeedPackage } from './seeds'
import {
  edgeId,
  lockfileId,
  organizationId,
  repositoryId,
  resolvesEdgeId,
  type DependencySpec,
  type Ecosystem,
  type Edge,
  type LockfileNode,
  type OrganizationNode,
  type PackageVersionNode,
  type RepositoryNode,
  type ResolvesEdge,
} from './types'

interface QueueEntry {
  ecosystem: Ecosystem
  name: string
  depth: number
  pinnedVersions?: string[]
}

interface FetchResult {
  entry: QueueEntry
  raw: NpmPackageRaw | PypiPackageRaw
  spec: DependencySpec[]
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const current = cursor++
      results[current] = await fn(items[current])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function toQueueEntry(seed: SeedPackage, ecosystem: Ecosystem): QueueEntry {
  return { ecosystem, name: seed.name, depth: 0, pinnedVersions: seed.versions }
}

function buildSeedQueue(): QueueEntry[] {
  const npm = NPM_SEEDS.map((seed) => toQueueEntry(seed, 'npm'))
  const pypi = PYPI_SEEDS.map((seed) => toQueueEntry(seed, 'PyPI'))
  const queue: QueueEntry[] = []
  for (let i = 0; i < Math.max(npm.length, pypi.length); i++) {
    if (npm[i]) queue.push(npm[i])
    if (pypi[i]) queue.push(pypi[i])
  }
  return queue
}

export async function runIngestion(): Promise<void> {
  const startedAt = Date.now()
  const writer = new GraphWriter()

  const versionByPackage = new Map<string, PackageVersionNode[]>()
  const allSpecs: Array<{ ecosystem: Ecosystem; spec: DependencySpec[] }> = []
  const packages: Array<{ ecosystem: Ecosystem; name: string }> = []

  const seen = new Set<string>()
  const enqueue = (
    list: QueueEntry[],
    ecosystem: Ecosystem,
    name: string,
    depth: number,
    pinnedVersions?: string[]
  ) => {
    const key = `${ecosystem}:${name}`
    if (seen.has(key)) return
    seen.add(key)
    list.push({ ecosystem, name, depth, pinnedVersions })
  }

  let frontier: QueueEntry[] = []
  for (const seed of buildSeedQueue()) {
    enqueue(frontier, seed.ecosystem, seed.name, seed.depth, seed.pinnedVersions)
  }

  while (frontier.length > 0 && packages.length < env.INGESTION_MAX_PACKAGES) {
    const nextFrontier: QueueEntry[] = []

    while (frontier.length > 0 && packages.length < env.INGESTION_MAX_PACKAGES) {
      const batch = frontier.splice(0, Math.min(env.INGESTION_CONCURRENCY, frontier.length))
      const results = await mapLimit(batch, env.INGESTION_CONCURRENCY, async (entry): Promise<FetchResult | null> => {
        const raw = await fetchRegistryPackage(entry.ecosystem, entry.name)
        if (!raw) return null
        return { entry, raw, spec: [] }
      })

      for (const result of results) {
        if (!result) continue
        const { entry, raw } = result
        const normalized = normalizePackage(entry.ecosystem, raw, {
          pinnedVersions: entry.pinnedVersions,
        })

        writer.addPackages([normalized.packageNode])
        writer.addVersions(normalized.versionNodes)
        writer.addMaintainers(normalized.maintainerNodes)
        writer.addEdges('HAS_VERSION', normalized.hasVersionEdges)
        writer.addEdges('MAINTAINED_BY', normalized.maintainerEdges)

        versionByPackage.set(`${entry.ecosystem}:${entry.name}`, normalized.versionNodes)
        allSpecs.push({ ecosystem: entry.ecosystem, spec: normalized.dependencySpecs })
        packages.push({ ecosystem: entry.ecosystem, name: entry.name })

        if (entry.depth < env.INGESTION_MAX_DEPTH) {
          for (const spec of normalized.dependencySpecs) {
            enqueue(nextFrontier, entry.ecosystem, spec.name, entry.depth + 1)
          }
        }
      }
    }

    frontier = nextFrontier
  }

  const dependencyEdges: Edge[] = []
  for (const { ecosystem, spec } of allSpecs) {
    for (const dependency of spec) {
      const targets = versionByPackage.get(`${ecosystem}:${dependency.name}`) ?? []
      for (const target of targets) {
        dependencyEdges.push({
          id: edgeId('DEPENDS_ON', dependency.source, target.id),
          source: dependency.source,
          target: target.id,
        })
      }
    }
  }
  writer.addEdges('DEPENDS_ON', dependencyEdges)

  const advisoryPackages = packages.map((pkg) => ({
    ecosystem: pkg.ecosystem,
    name: pkg.name,
    versions: (versionByPackage.get(`${pkg.ecosystem}:${pkg.name}`) ?? []).map((node) => node.version),
  }))
  const advisoryRecords = await fetchAdvisories(advisoryPackages)
  writer.addAdvisories(advisoryRecords.map((record) => record.node))

  const versionIdByKey = new Map<string, number>()
  for (const nodes of versionByPackage.values()) {
    for (const node of nodes) {
      versionIdByKey.set(`${node.ecosystem}:${node.name}:${node.version}`, node.id)
    }
  }

  const affectedEdges: Edge[] = []
  for (const record of advisoryRecords) {
    const nodeId = record.node.id
    for (const affected of record.affected) {
      for (const version of affected.versions) {
        const source = versionIdByKey.get(`${affected.ecosystem}:${affected.name}:${version}`)
        if (source === undefined) continue
        affectedEdges.push({
          id: edgeId('AFFECTED_BY', source, nodeId),
          source,
          target: nodeId,
        })
      }
    }
  }
  writer.addEdges('AFFECTED_BY', affectedEdges)

  await ingestDemoOrg(writer, versionIdByKey)

  const summary = await writer.flush()
  const durationMs = Date.now() - startedAt

  const npm = packages.filter((pkg) => pkg.ecosystem === 'npm').length
  const pypi = packages.filter((pkg) => pkg.ecosystem === 'PyPI').length
  console.log('Ingestion complete')
  console.log(`  packages:      ${packages.length} (npm ${npm}, PyPI ${pypi})`)
  console.log(`  versions:      ${summary.versions}`)
  console.log(`  maintainers:   ${summary.maintainers}`)
  console.log(`  advisories:    ${summary.advisories}`)
  console.log(`  organizations: ${summary.organizations}`)
  console.log(`  repositories:  ${summary.repositories}`)
  console.log(`  lockfiles:     ${summary.lockfiles}`)
  console.log(`  edges:         ${JSON.stringify(summary.edges)}`)
  console.log(`  duration:      ${(durationMs / 1000).toFixed(1)}s`)
}

async function ingestDemoOrg(
  writer: GraphWriter,
  versionIdByKey: Map<string, number>
): Promise<void> {
  const manifest = loadDemoOrg(env.DEMO_ORG_PATH)
  if (!manifest) {
    console.warn(`demo org manifest not found at ${env.DEMO_ORG_PATH}; skipping organization graph`)
    return
  }

  const orgNode: OrganizationNode = { id: organizationId(manifest.org), name: manifest.org }
  writer.addOrganizations([orgNode])
  const ownsEdges: Edge[] = []

  for (const repo of manifest.repositories) {
    const repoId = repositoryId(manifest.org, repo.name)
    const repoNode: RepositoryNode = {
      id: repoId,
      name: repo.name,
      org: manifest.org,
      language: repo.language,
      kind: repo.kind,
    }
    writer.addRepositories([repoNode])
    ownsEdges.push({ id: edgeId('OWNS', orgNode.id, repoId), source: orgNode.id, target: repoId })

    const hasLockfileEdges: Edge[] = []
    const resolvesEdges: ResolvesEdge[] = []
    for (const lockfile of repo.lockfiles) {
      const content = readLockfile(env.DEMO_ORG_PATH, lockfile.path)
      if (!content) {
        console.warn(`  lockfile not found: ${lockfile.path}`)
        continue
      }
      const dependencies = parseLockfile(lockfile.path, lockfile.ecosystem, content)
      const lockId = lockfileId(repo.name, lockfile.path)
      const lockNode: LockfileNode = {
        id: lockId,
        path: lockfile.path,
        ecosystem: lockfile.ecosystem,
        repository: repo.name,
        commitSha: manifest.commitSha,
        kind: repo.kind,
      }
      writer.addLockfiles([lockNode])
      hasLockfileEdges.push({ id: edgeId('HAS_LOCKFILE', repoId, lockId), source: repoId, target: lockId })

      let linked = 0
      for (const dep of dependencies) {
        const versionId = versionIdByKey.get(`${dep.ecosystem}:${dep.name}:${dep.resolvedVersion}`)
        if (versionId === undefined) continue
        resolvesEdges.push({
          id: resolvesEdgeId(lockId, versionId, dep.requestedVersion),
          source: lockId,
          target: versionId,
          requestedVersion: dep.requestedVersion ?? '',
          resolvedVersion: dep.resolvedVersion,
          lockfilePath: lockfile.path,
          repository: repo.name,
          commitSha: manifest.commitSha,
        })
        linked += 1
      }
      console.log(
        `  ${repo.name} ${lockfile.path}: ${dependencies.length} resolved, ${linked} linked to graph`
      )
    }
    writer.addEdges('HAS_LOCKFILE', hasLockfileEdges)
    writer.addEdges('RESOLVES', resolvesEdges)
  }

  writer.addEdges('OWNS', ownsEdges)
}

if (import.meta.main) {
  runIngestion().catch((error) => {
    console.error('ingestion failed:', error)
    process.exit(1)
  })
}
