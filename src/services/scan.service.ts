import {
  analyzeExposure,
  computeMinimalFixSet,
  summarizeExposure,
  type ExposureResult,
  type FixSetResult,
  type ResolvedDepRef,
} from '../analysis/exposure'
import { fetchOsvFindings } from '../analysis/osv-findings'
import { GraphWriter } from '../ingestion/graph-writer'
import { parseLockfile } from '../ingestion/lockfile'
import {
  edgeId,
  lockfileId,
  packageVersionId,
  repositoryId,
  resolvesEdgeId,
  type Ecosystem,
  type Edge,
  type LockfileNode,
  type RepositoryNode,
  type ResolvesEdge,
} from '../ingestion/types'
import { fetchManifestBundle, parseRepo, type ManifestBundle, type RawFile } from '../lib/github'
import { AppError } from '../lib/errors'
import { hydra, rowsToObjects } from '../hydra/client'
import { repoLockfilesQuery, resolutionsForLockfileQuery } from '../hydra/queries'

const SUPPORTED_LOCKFILES: Array<{ match: (path: string) => boolean; ecosystem: Ecosystem }> = [
  { match: (path) => path === 'package-lock.json', ecosystem: 'npm' },
  { match: (path) => path === 'yarn.lock', ecosystem: 'npm' },
  { match: (path) => path === 'pnpm-lock.yaml', ecosystem: 'npm' },
  { match: (path) => path === 'bun.lock', ecosystem: 'npm' },
  { match: (path) => path === 'uv.lock', ecosystem: 'PyPI' },
  { match: (path) => /requirements.*\.txt$/i.test(path), ecosystem: 'PyPI' },
]

function ecosystemFor(path: string): Ecosystem | null {
  return SUPPORTED_LOCKFILES.find((entry) => entry.match(path))?.ecosystem ?? null
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

export interface ScanLockfileSummary {
  path: string
  ecosystem?: Ecosystem
  status: 'ok' | 'unsupported' | 'error'
  resolved?: number
  linked?: number
  message?: string
}

export interface ScanResult {
  repo: { owner: string; name: string; label: string; scannedAt: string }
  lockfiles: ScanLockfileSummary[]
  exposure: ExposureResult
  fixSet: FixSetResult
  latencyMs: number
}

function parseableFiles(bundle: ManifestBundle): RawFile[] {
  return bundle.files.filter((file) => ecosystemFor(file.path) !== null)
}

export async function scanRepository(repoInput: string): Promise<ScanResult> {
  const startedAt = performance.now()
  const repo = parseRepo(repoInput)
  const repoLabel = `${repo.owner}/${repo.name}`
  const bundle = await fetchManifestBundle(repo)

  const parseable = parseableFiles(bundle)
  if (parseable.length === 0) {
    throw new AppError(
      422,
      'no_supported_lockfile',
      `${repoLabel} has manifests but no supported lockfile (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lock, uv.lock, requirements*.txt)`
    )
  }

  const writer = new GraphWriter()
  const scannedAt = bundle.scannedAt

  const repoNode: RepositoryNode = {
    id: repositoryId(repo.owner, repo.name),
    name: repo.name,
    org: repo.owner,
    language: detectLanguage(bundle),
    kind: 'application',
  }
  writer.addRepositories([repoNode])

  const parsedByFile = new Map<string, { ecosystem: Ecosystem; deps: ResolvedDepRef[] }>()
  const lockfiles: ScanLockfileSummary[] = []
  const allIds: number[] = []

  for (const file of bundle.files) {
    const ecosystem = ecosystemFor(file.path)
    if (!ecosystem) {
      if (/\.(lock|json|yaml|yml|toml)$/.test(file.path)) {
        lockfiles.push({ path: file.path, status: 'unsupported' })
      }
      continue
    }

    try {
      const parsed = parseLockfile(file.path, ecosystem, file.content)
      const deps = parsed.map((dep) => ({
        ecosystem: dep.ecosystem,
        name: dep.name,
        requestedVersion: dep.requestedVersion,
        resolvedVersion: dep.resolvedVersion,
        lockfilePath: file.path,
        path: dep.path,
      }))
      parsedByFile.set(file.path, { ecosystem, deps })
      for (const dep of deps) {
        allIds.push(packageVersionId(dep.ecosystem, dep.name, dep.resolvedVersion))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lockfiles.push({ path: file.path, ecosystem, status: 'error', message })
    }
  }

  const existingVersionIds = await findExistingVersionIds(allIds)

  const hasLockfileEdges: Edge[] = []
  const resolvesEdges: ResolvesEdge[] = []
  const allDeps: ResolvedDepRef[] = []

  for (const [path, { ecosystem, deps }] of parsedByFile) {
    const lockId = lockfileId(repoLabel, path)
    const lockNode: LockfileNode = {
      id: lockId,
      path,
      ecosystem,
      repository: repoLabel,
      commitSha: 'HEAD',
      kind: 'application',
    }
    writer.addLockfiles([lockNode])
    hasLockfileEdges.push({
      id: edgeId('HAS_LOCKFILE', repoNode.id, lockId),
      source: repoNode.id,
      target: lockId,
    })

    let linked = 0
    for (const dep of deps) {
      const versionId = packageVersionId(dep.ecosystem, dep.name, dep.resolvedVersion)
      if (existingVersionIds.has(versionId)) {
        resolvesEdges.push({
          id: resolvesEdgeId(lockId, versionId, dep.requestedVersion),
          source: lockId,
          target: versionId,
          requestedVersion: dep.requestedVersion ?? '',
          resolvedVersion: dep.resolvedVersion,
          lockfilePath: path,
          repository: repoLabel,
          commitSha: 'HEAD',
          scannedAt,
          internalPath: dep.path ?? '',
        })
        linked += 1
      }
      allDeps.push(dep)
    }
    lockfiles.push({
      path,
      ecosystem,
      status: 'ok',
      resolved: deps.length,
      linked,
    })
  }

  writer.addEdges('HAS_LOCKFILE', hasLockfileEdges)
  writer.addEdges('RESOLVES', resolvesEdges)
  await writer.flush()

  const graphExposure = await analyzeExposure(allDeps, repoLabel)
  const skipKeys = new Set(
    graphExposure.findings.map(
      (finding) => `${finding.advisory.id}:${finding.package}@${finding.resolvedVersion}`
    )
  )
  const osvFindings = await fetchOsvFindings(allDeps, repoLabel, skipKeys)
  const mergedFindings = [...graphExposure.findings, ...osvFindings]

  const totalResolved = new Set(
    allDeps.map((dep) => `${dep.ecosystem}:${dep.name}@${dep.resolvedVersion}`)
  ).size
  const exposure = summarizeExposure(
    mergedFindings,
    totalResolved,
    graphExposure.linked,
    graphExposure.unlinked
  )
  const fixSet = await computeMinimalFixSet(exposure.findings)
  const latencyMs = Math.round(performance.now() - startedAt)

  return {
    repo: { owner: repo.owner, name: repo.name, label: repoLabel, scannedAt },
    lockfiles: lockfiles.sort((a, b) => a.path.localeCompare(b.path)),
    exposure,
    fixSet,
    latencyMs,
  }
}

async function findExistingVersionIds(ids: number[]): Promise<Set<number>> {
  const existing = new Set<number>()
  const QUERY = `
    MATCH (v:PackageVersion {id: $id})
    RETURN v.id AS id
  `
  const batches = await mapLimit([...new Set(ids)], 8, async (id) => {
    const rows = rowsToObjects(
      await hydra.query(QUERY, { parameters: { id }, consistency: 'causal' })
    )
    return rows.length > 0 ? [id] : []
  })
  for (const batch of batches) for (const id of batch) existing.add(id)
  return existing
}

export async function analyzeRepository(owner: string, name: string): Promise<ScanResult> {
  const startedAt = performance.now()
  const repoLabel = `${owner}/${name}`

  const rows = rowsToObjects(
    await hydra.query(repoLockfilesQuery, {
      parameters: { repo: repoLabel },
      consistency: 'causal',
    })
  )
  if (rows.length === 0) {
    throw new AppError(404, 'repo_not_scanned', `${repoLabel} has not been scanned`)
  }

  const deps: ResolvedDepRef[] = []
  const lockfiles: ScanLockfileSummary[] = []
  let lastScannedAt = ''
  for (const row of rows) {
    const lockId = Number(row.id)
    const path = String(row.path)
    const ecosystem = (String(row.ecosystem) as Ecosystem) ?? 'npm'
    const resolutionRows = rowsToObjects(
      await hydra.query(resolutionsForLockfileQuery, {
        parameters: { id: lockId },
        consistency: 'causal',
      })
    )
    for (const resolution of resolutionRows) {
      const scannedAt = String(resolution.scannedAt ?? '')
      if (scannedAt > lastScannedAt) lastScannedAt = scannedAt
      deps.push({
        ecosystem: (String(resolution.ecosystem) as Ecosystem) ?? ecosystem,
        name: String(resolution.name),
        requestedVersion: String(resolution.requestedVersion ?? '') || undefined,
        resolvedVersion: String(resolution.resolvedVersion),
        lockfilePath: path,
      })
    }
    lockfiles.push({ path, ecosystem, status: 'ok', resolved: resolutionRows.length, linked: resolutionRows.length })
  }

  const graphExposure = await analyzeExposure(deps, repoLabel)
  const skipKeys = new Set(
    graphExposure.findings.map(
      (finding) => `${finding.advisory.id}:${finding.package}@${finding.resolvedVersion}`
    )
  )
  const osvFindings = await fetchOsvFindings(deps, repoLabel, skipKeys)
  const mergedFindings = [...graphExposure.findings, ...osvFindings]
  const totalResolved = new Set(
    deps.map((dep) => `${dep.ecosystem}:${dep.name}@${dep.resolvedVersion}`)
  ).size
  const exposure = summarizeExposure(
    mergedFindings,
    totalResolved,
    graphExposure.linked,
    graphExposure.unlinked
  )
  const fixSet = await computeMinimalFixSet(exposure.findings)
  const latencyMs = Math.round(performance.now() - startedAt)

  return {
    repo: {
      owner,
      name,
      label: repoLabel,
      scannedAt: lastScannedAt,
    },
    lockfiles,
    exposure,
    fixSet,
    latencyMs,
  }
}

function detectLanguage(bundle: ManifestBundle): string {
  const npm = bundle.files.some((file) => /package-lock\.json$/.test(file.path))
  const python = bundle.files.some((file) =>
    /(uv\.lock|requirements.*\.txt)$/.test(file.path)
  )
  if (npm && python) return 'TypeScript/JavaScript + Python'
  if (npm) return 'TypeScript/JavaScript'
  if (python) return 'Python'
  return 'unknown'
}
