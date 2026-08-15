import { decodeValue, hydra, rowsToObjects, type Path } from '../hydra/client'
import {
  advisoriesForVersionIdQuery,
  blastRadiusQuery,
  versionAdvisoryCountQuery,
} from '../hydra/queries'
import { packageVersionId } from '../ingestion/types'
import type { Ecosystem } from '../ingestion/types'

export interface ResolvedDepRef {
  ecosystem: Ecosystem
  name: string
  requestedVersion?: string
  resolvedVersion: string
  lockfilePath: string
  /** node_modules path within the lockfile */
  path?: string
}

export interface ScanFinding {
  package: string
  ecosystem: Ecosystem
  resolvedVersion: string
  requestedVersion?: string
  severity: string
  advisory: {
    id: string
    summary: string
    publishedAt: string
    modifiedAt: string
    references: string
  }
  fix: string | null
  fixedVersion?: string
  /** 'graph' when found via HydraDB AFFECTED_BY edges, 'osv' when live-checked */
  source: 'graph' | 'osv'
  /** exposure paths: [repo, lockfile, ...dependency chain] */
  paths: string[][]
  depth: number
}

export interface ExposureScore {
  total: number
  severity: string
  breakdown: Record<string, number>
}

export interface ExposureResult {
  findings: ScanFinding[]
  score: ExposureScore
  vulnerable: number
  clean: number
  linked: number
  unlinked: Array<{ ecosystem: Ecosystem; name: string; version: string }>
}

const SEVERITY_POINTS: Record<string, number> = {
  CRITICAL: 80,
  HIGH: 56,
  MODERATE: 32,
  LOW: 8,
  UNKNOWN: 16,
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MODERATE: 2,
  LOW: 1,
  UNKNOWN: 0,
}

function fixCommand(ecosystem: Ecosystem, name: string, fixed: string): string {
  return ecosystem === 'npm' ? `npm install ${name}@${fixed}` : `pip install ${name}==${fixed}`
}

function decodeFixedVersions(value: unknown): Record<string, string> {
  if (typeof value !== 'string' || value === '') return {}
  try {
    return JSON.parse(value) as Record<string, string>
  } catch {
    return {}
  }
}

interface AdvisoryRow {
  versionId: number
  name: string
  version: string
  ecosystem: string
  advisoryId: string | null
  severity: string
  summary: string
  publishedAt: string
  modifiedAt: string
  fixedVersions: string
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

async function fetchAdvisoryRows(versionIds: number[]): Promise<AdvisoryRow[]> {
  const rows = await mapLimit(versionIds, 8, async (versionId) => {
    const response = await hydra.query(advisoriesForVersionIdQuery, {
      parameters: { id: versionId },
      consistency: 'causal',
    })
    return rowsToObjects(response).map((row) => ({
      versionId: Number(row.versionId),
      name: String(row.name),
      version: String(row.version),
      ecosystem: String(row.ecosystem ?? ''),
      advisoryId: row.advisoryId === null ? null : String(row.advisoryId),
      severity: String(row.severity ?? 'UNKNOWN'),
      summary: String(row.summary ?? ''),
      publishedAt: String(row.publishedAt ?? ''),
      modifiedAt: String(row.modifiedAt ?? ''),
      fixedVersions: String(row.fixedVersions ?? ''),
    }))
  })
  return rows.flat()
}

async function findDependencyChains(
  appIds: Set<number>,
  versionId: number,
  repoLabel: string,
  lockfilePath: string,
  name: string,
  version: string
): Promise<{ paths: string[][]; depth: number }> {
  const base = [repoLabel, lockfilePath, `${name}@${version}`]
  try {
    const response = await hydra.query(blastRadiusQuery(5), {
      parameters: { source: versionId },
      consistency: 'causal',
      timeoutMs: 5000,
    })
    let best: { chain: string[]; depth: number } | null = null
    for (const row of response.rows) {
      const path = decodeValue(row[0]) as Path
      const nodes = path.nodes
      const source = nodes[nodes.length - 1]
      if (!source || source.id !== versionId) continue
      const first = nodes[0]
      if (!first || !appIds.has(first.id)) continue
      const depth = nodes.length - 1
      const chain = nodes.map((n) => {
        const props = n.properties as Record<string, unknown>
        return `${props.name}@${props.version}`
      })
      if (!best || depth < best.depth) best = { chain, depth }
    }
    if (!best) return { paths: [base], depth: 0 }
    return { paths: [[repoLabel, lockfilePath, ...best.chain]], depth: best.depth }
  } catch (error) {
    console.warn(`[exposure] dependency chain query failed for ${name}@${version}:`, error)
    return { paths: [base], depth: 0 }
  }
}

export async function analyzeExposure(
  deps: ResolvedDepRef[],
  repoLabel: string
): Promise<ExposureResult> {
  const withIds = deps.map((dep) => ({
    ...dep,
    versionId: packageVersionId(dep.ecosystem, dep.name, dep.resolvedVersion),
  }))
  const ids = withIds.map((dep) => dep.versionId)

  const rows = await fetchAdvisoryRows(ids)
  const rowsByVersion = new Map<number, AdvisoryRow[]>()
  for (const row of rows) {
    const bucket = rowsByVersion.get(row.versionId) ?? []
    bucket.push(row)
    rowsByVersion.set(row.versionId, bucket)
  }

  const presentIds = [...rowsByVersion.keys()]
  const appIds = new Set(presentIds)
  const findings: ScanFinding[] = []
  const vulnerableVersions = new Set<number>()

  for (const dep of withIds) {
    const versionRows = rowsByVersion.get(dep.versionId)
    if (!versionRows) continue
    const advisoryRows = versionRows.filter((row) => row.advisoryId !== null)
    if (advisoryRows.length === 0) continue
    vulnerableVersions.add(dep.versionId)

    const chains = await findDependencyChains(
      appIds,
      dep.versionId,
      repoLabel,
      dep.lockfilePath,
      dep.name,
      dep.resolvedVersion
    )

    for (const row of advisoryRows) {
      if (!row.advisoryId) continue
      const fixed = decodeFixedVersions(row.fixedVersions)
      const fixedVersion = fixed[dep.name] ?? null
      findings.push({
        package: dep.name,
        ecosystem: dep.ecosystem,
        resolvedVersion: dep.resolvedVersion,
        requestedVersion: dep.requestedVersion,
        severity: row.severity,
        advisory: {
          id: row.advisoryId,
          summary: row.summary,
          publishedAt: row.publishedAt,
          modifiedAt: row.modifiedAt,
          references: '',
        },
        fix:
          fixedVersion && fixedVersion !== dep.resolvedVersion
            ? fixCommand(dep.ecosystem, dep.name, fixedVersion)
            : null,
        fixedVersion: fixedVersion && fixedVersion !== dep.resolvedVersion ? fixedVersion : undefined,
        source: 'graph',
        paths: chains.paths,
        depth: chains.depth,
      })
    }
  }

  const unlinked = withIds
    .filter((dep) => !rowsByVersion.has(dep.versionId))
    .map((dep) => ({
      ecosystem: dep.ecosystem,
      name: dep.name,
      version: dep.resolvedVersion,
    }))

  const breakdown: Record<string, number> = {}
  let points = 0
  let worst: string | null = null
  for (const finding of findings) {
    const severity = finding.severity.toUpperCase()
    breakdown[severity] = (breakdown[severity] ?? 0) + 1
    points += SEVERITY_POINTS[severity] ?? SEVERITY_POINTS.UNKNOWN
    if (!worst || SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) worst = severity
  }

  return {
    findings,
    score: {
      total: Math.min(100, points),
      severity: worst ?? 'CLEAN',
      breakdown,
    },
    vulnerable: vulnerableVersions.size,
    clean: presentIds.length - vulnerableVersions.size,
    linked: presentIds.length,
    unlinked,
  }
}

const findingVersionKey = (finding: ScanFinding) =>
  `${finding.ecosystem}:${finding.package}@${finding.resolvedVersion}`

/**
 * Derive the exposure result for an arbitrary finding set (used after merging
 * graph findings with live OSV findings).
 */
export function summarizeExposure(
  findings: ScanFinding[],
  totalResolved: number,
  linked: number,
  unlinked: ExposureResult['unlinked']
): ExposureResult {
  const vulnerableVersions = new Set(findings.map(findingVersionKey))
  const breakdown: Record<string, number> = {}
  let points = 0
  let worst: string | null = null
  for (const finding of findings) {
    const severity = finding.severity.toUpperCase()
    breakdown[severity] = (breakdown[severity] ?? 0) + 1
    points += SEVERITY_POINTS[severity] ?? SEVERITY_POINTS.UNKNOWN
    if (!worst || SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) worst = severity
  }
  return {
    findings,
    score: {
      total: Math.min(100, points),
      severity: worst ?? 'CLEAN',
      breakdown,
    },
    vulnerable: vulnerableVersions.size,
    clean: Math.max(0, totalResolved - vulnerableVersions.size),
    linked,
    unlinked,
  }
}

export interface FixUpgrade {
  package: string
  ecosystem: Ecosystem
  from: string
  to: string
  findingCount: number
  command: string
  /** true when the target version exists in HydraDB and has zero advisories */
  verified: boolean
}

export interface FixSetResult {
  upgrades: FixUpgrade[]
  verified: number
  total: number
  commands: string[]
}

/**
 * Greedy minimal-fix set: the fewest package upgrades that clear every finding,
 * each one *verified* by re-traversing HydraDB — the target version must exist
 * and resolve to zero advisories.
 */
export async function computeMinimalFixSet(findings: ScanFinding[]): Promise<FixSetResult> {
  const byPackage = new Map<string, ScanFinding[]>()
  for (const finding of findings) {
    if (!finding.fixedVersion) continue
    const key = `${finding.ecosystem}:${finding.package}`
    const bucket = byPackage.get(key) ?? []
    bucket.push(finding)
    byPackage.set(key, bucket)
  }

  interface CandidateUpgrade {
    ecosystem: Ecosystem
    name: string
    from: string
    to: string
    findingCount: number
  }

  const upgrades: CandidateUpgrade[] = [...byPackage.entries()]
    .map(([key, bucket]) => {
      const first = bucket[0]
      const [ecosystem, name] = key.split(':') as [Ecosystem, string]
      return {
        ecosystem,
        name,
        from: first.resolvedVersion,
        to: first.fixedVersion as string,
        findingCount: bucket.length,
      }
    })
    .sort((a, b) => b.findingCount - a.findingCount)

  if (upgrades.length === 0) return { upgrades: [], verified: 0, total: 0, commands: [] }

  const result = await mapLimit(upgrades, 8, async (upgrade) => {
    const targetId = packageVersionId(upgrade.ecosystem, upgrade.name, upgrade.to)
    const rows = rowsToObjects(
      await hydra.query(versionAdvisoryCountQuery, {
        parameters: { id: targetId },
        consistency: 'causal',
      })
    )
    const advisoryCount = rows.length === 0 ? 0 : Number(rows[0].count)
    const verified = rows.length > 0 && advisoryCount === 0
    return {
      package: upgrade.name,
      ecosystem: upgrade.ecosystem,
      from: upgrade.from,
      to: upgrade.to,
      findingCount: upgrade.findingCount,
      command: fixCommand(upgrade.ecosystem, upgrade.name, upgrade.to),
      verified,
    }
  })

  return {
    upgrades: result,
    verified: result.filter((upgrade) => upgrade.verified).length,
    total: result.length,
    commands: result.map((upgrade) => upgrade.command),
  }
}
