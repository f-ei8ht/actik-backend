import { hydra, rowsToObjects } from '../hydra/client'
import { blastRadiusQuery, lookupPackageIdQuery, resolutionsForVersionIdQuery } from '../hydra/queries'
import type { QueryResponse } from '../hydra/schema'
import { decodeValue, type Path } from '../hydra/client'

const QUERY_CHUNK = 500

export interface PropagationApp {
  repository: string
  lockfile: string
  kind: string
  depth: number
  direct: boolean
  chain: string[]
  exposedAt: string
}

export interface PropagationResult {
  package: { name: string; version: string; ecosystem: string }
  compromisedAt: string
  perHopMs: number
  directApps: number
  transitiveApps: number
  totalApps: number
  maxDepth: number
  firstExposedAt: string | null
  lastExposedAt: string | null
  medianExposedAt: string | null
  spanMs: number
  apps: PropagationApp[]
  timeline: Array<{ exposedAt: string; repository: string; depth: number }>
}

export interface PropagationOptions {
  compromisedAt?: string
  perHopMs?: number
  maxDepth?: number
}

const DEFAULT_PER_HOP_MS = 6 * 60 * 1000

interface DepthInfo {
  depth: number
  chain: string[]
}

function collectDepthInfo(rows: QueryResponse['rows'], sourceId: number): Map<number, DepthInfo> {
  const byId = new Map<number, DepthInfo>()
  for (const row of rows) {
    const path = decodeValue(row[0]) as Path
    const nodes = path.nodes
    const source = nodes[0]
    if (!source || source.id !== sourceId) continue
    for (let i = 1; i < nodes.length; i++) {
      const node = nodes[i]
      const chain = nodes
        .slice(0, i + 1)
        .reverse()
        .map((n) => {
          const props = n.properties as Record<string, unknown>
          return `${props.name}@${props.version}`
        })
      const existing = byId.get(node.id)
      if (!existing || i < existing.depth) byId.set(node.id, { depth: i, chain })
    }
  }
  // Apps resolving the compromised version directly are exposed at t=0.
  byId.set(sourceId, { depth: 0, chain: [] })
  return byId
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

async function fetchResolutions(versionIds: number[]): Promise<Record<string, unknown>[]> {
  const batches = await mapLimit(versionIds, 8, async (versionId) => {
    const response = await hydra.query(resolutionsForVersionIdQuery, {
      parameters: { id: versionId },
      consistency: 'causal',
    })
    return rowsToObjects(response)
  })
  return batches.flat()
}

/**
 * Worm / propagation simulation. Compromise a package at t=0 and
 * compute, for every app resolving a reachable version, when the compromise
 * reaches it: `exposedAt = compromisedAt + depth * perHopMs` where depth is
 * the shortest DEPENDS_ON chain from the app's resolved version to the
 * compromised version.
 */
export async function simulatePropagation(
  name: string,
  version: string,
  ecosystem?: string,
  options: PropagationOptions = {}
): Promise<PropagationResult | null> {
  const maxDepth = options.maxDepth ?? 10
  const perHopMs = options.perHopMs ?? DEFAULT_PER_HOP_MS
  const compromisedAt = options.compromisedAt ?? new Date().toISOString()

  const response = await hydra.query(lookupPackageIdQuery(ecosystem), {
    parameters: { name, version, ...(ecosystem ? { ecosystem } : {}) },
    consistency: 'causal',
  })
  const lookup = rowsToObjects(response)
  if (lookup.length === 0) return null
  const sourceId = Number(lookup[0].id)

  const paths = await hydra.query(blastRadiusQuery(maxDepth), {
    parameters: { source: sourceId },
    consistency: 'causal',
  })

  const depthInfo = collectDepthInfo(paths.rows, sourceId)
  const closureIds = [...depthInfo.keys()]
  const resolutions = await fetchResolutions(closureIds)

  const byApp = new Map<string, PropagationApp>()
  for (const row of resolutions) {
    const versionId = Number(row.versionId)
    const info = depthInfo.get(versionId)
    if (!info) continue
    const repository = String(row.repository)
    const exposedAt = new Date(
      new Date(compromisedAt).getTime() + info.depth * perHopMs
    ).toISOString()
    const existing = byApp.get(repository)
    const candidate: PropagationApp = {
      repository,
      lockfile: String(row.lockfile),
      kind: String(row.kind ?? ''),
      depth: info.depth,
      direct: info.depth === 0,
      chain: info.chain.length > 0 ? info.chain : [`${row.name}@${row.version}`],
      exposedAt,
    }
    if (!existing || info.depth < existing.depth) byApp.set(repository, candidate)
  }

  const apps = [...byApp.values()].sort((a, b) => a.exposedAt.localeCompare(b.exposedAt))
  const maxDepthReached = Math.max(0, ...apps.map((app) => app.depth))

  const exposedTimes = apps.map((app) => new Date(app.exposedAt).getTime())
  const firstExposedAt = apps.length ? apps[0].exposedAt : null
  const lastExposedAt = apps.length ? apps[apps.length - 1].exposedAt : null
  const medianExposedAt = apps.length
    ? new Date(exposedTimes[Math.floor(exposedTimes.length / 2)]).toISOString()
    : null
  const spanMs = exposedTimes.length > 1 ? exposedTimes[exposedTimes.length - 1] - exposedTimes[0] : 0

  return {
    package: { name, version, ecosystem: ecosystem ?? '' },
    compromisedAt,
    perHopMs,
    directApps: apps.filter((app) => app.direct).length,
    transitiveApps: apps.filter((app) => !app.direct).length,
    totalApps: apps.length,
    maxDepth: maxDepthReached,
    firstExposedAt,
    lastExposedAt,
    medianExposedAt,
    spanMs,
    apps,
    timeline: apps.map((app) => ({
      exposedAt: app.exposedAt,
      repository: app.repository,
      depth: app.depth,
    })),
  }
}
