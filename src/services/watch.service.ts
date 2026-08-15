import { hydra, rowsToObjects } from '../hydra/client'
import {
  distinctResolvedVersionsQuery,
  existingAlertKeysQuery,
  recentIncidentsQuery,
  upsertAlertNodesQuery,
  upsertEdgesQuery,
} from '../hydra/queries'
import { env } from '../lib/config'
import { edgeId, hashString } from '../ingestion/types'
import { normalizeAdvisory } from '../ingestion/normalize'
import type { OsvVulnDoc } from '../ingestion/version'
import type { Ecosystem } from '../ingestion/types'

interface WatchedVersion {
  versionId: number
  name: string
  version: string
  ecosystem: string
}

interface WatchState {
  lastRunAt: string | null
  lastChecked: number
  lastNew: number
  lastExisting: number
  lastError: string | null
}

const state: WatchState = {
  lastRunAt: null,
  lastChecked: 0,
  lastNew: 0,
  lastExisting: 0,
  lastError: null,
}

export interface WatchStatus {
  lastRunAt: string | null
  lastChecked: number
  lastNew: number
  lastExisting: number
  lastError: string | null
}

export interface Incident {
  advisoryId: string
  severity: string
  summary: string
  package: string
  version: string
  ecosystem: string
  fixedVersion: string
  firstSeenAt: string
  repositories: string[]
  lockfiles: string[]
  exposurePath: string[]
}

export function getWatchStatus(): WatchStatus {
  return { ...state }
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

async function fetchWatchedVersions(): Promise<WatchedVersion[]> {
  const rows = rowsToObjects(
    await hydra.query(distinctResolvedVersionsQuery, { consistency: 'causal' })
  )
  return rows.map((row) => ({
    versionId: Number(row.versionId),
    name: String(row.name),
    version: String(row.version),
    ecosystem: String(row.ecosystem ?? ''),
  }))
}

async function fetchExistingAlertKeys(): Promise<Set<string>> {
  const rows = rowsToObjects(await hydra.query(existingAlertKeysQuery, { consistency: 'causal' }))
  return new Set(rows.map((row) => `${row.advisoryId}:${row.package}@${row.version}`))
}

interface OsvQueryResult {
  results?: Array<{ vulns?: Array<{ id?: string }> }>
}

interface OsvVulnList {
  id?: string
  withdrawn?: string | null
}

async function queryOsv(queries: unknown[]): Promise<Array<Array<{ id: string }>>> {
  const baseUrl = env.OSV_API_URL.replace(/\/+$/, '')
  const perQuery: Array<Array<{ id: string }>> = new Array(queries.length).fill([])
  const CHUNK = 100
  for (let offset = 0; offset < queries.length; offset += CHUNK) {
    const slice = queries.slice(offset, offset + CHUNK)
    const response = await fetch(`${baseUrl}/v1/querybatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: slice }),
    })
    if (!response.ok) throw new Error(`OSV querybatch ${response.status}: ${await response.text()}`)
    const doc = (await response.json()) as OsvQueryResult
    for (let i = 0; i < slice.length; i++) {
      const vulns = (doc.results?.[i]?.vulns ?? [])
        .filter((vuln): vuln is OsvVulnList & { id: string } => Boolean(vuln?.id))
        .map((vuln) => ({ id: vuln.id }))
      perQuery[offset + i] = vulns
    }
  }
  return perQuery
}

async function fetchVulnDetail(id: string): Promise<OsvVulnDoc | null> {
  const baseUrl = env.OSV_API_URL.replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/v1/vulns/${encodeURIComponent(id)}`)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`OSV vuln ${response.status} for ${id}: ${await response.text()}`)
  }
  return (await response.json()) as OsvVulnDoc
}

/**
 * Live watch. Poll OSV for every version that a scanned app resolves
 * and record newly-flagged advisories as Alert nodes with a `first_seen_at`,
 * linked to the affected version and every app that resolves it.
 */
export async function runLiveWatch(): Promise<WatchStatus> {
  const startedAt = Date.now()
  state.lastError = null
  try {
    const watched = await fetchWatchedVersions()
    const existing = await fetchExistingAlertKeys()
    const queries = watched.map((version) => ({
      package: { ecosystem: version.ecosystem, name: version.name },
      version: version.version,
    }))

    const perVersionVulns = queries.length ? await queryOsv(queries) : []
    const newKeys = new Set<string>()
    const newAlerts: Array<{ key: string; doc: OsvVulnDoc; version: WatchedVersion }> = []

    for (let i = 0; i < watched.length; i++) {
      const version = watched[i]
      for (const { id } of perVersionVulns[i]) {
        const key = `${id}:${version.name}@${version.version}`
        if (existing.has(key) || newKeys.has(key)) continue
        newKeys.add(key)
        const doc = await fetchVulnDetail(id)
        if (!doc?.id || doc.withdrawn) continue
        newAlerts.push({ key, doc, version })
      }
    }

    let created = 0
    if (newAlerts.length > 0) {
      const firstSeenAt = new Date().toISOString()
      const nodes = newAlerts.map(({ doc, version }) => {
        const advisory = normalizeAdvisory(doc)
        const fixedVersions = parseFixedVersions(advisory.fixedVersions)
        return {
          id: hashString(`alert:${doc.id}:${version.versionId}`),
          advisoryId: doc.id,
          severity: advisory.severity,
          summary: advisory.summary,
          package: version.name,
          version: version.version,
          ecosystem: version.ecosystem,
          fixedVersions: fixedVersions[version.name] ?? '',
          firstSeenAt,
        }
      })

      await hydra.query(upsertAlertNodesQuery, {
        parameters: { nodes },
      })
      await hydra.query(upsertEdgesQuery('ALERTS_ON', 'Alert', 'PackageVersion'), {
        parameters: {
          edges: newAlerts.map(({ doc, version }, index) => ({
            id: edgeId('ALERTS_ON', nodes[index].id, version.versionId),
            source: nodes[index].id,
            target: version.versionId,
          })),
        },
      })

      const versionByRepo = await fetchResolvingRepos(
        newAlerts.map((alert) => alert.version.versionId)
      )
      for (const { doc, version } of newAlerts) {
        const alertId = hashString(`alert:${doc.id}:${version.versionId}`)
        const repos = versionByRepo.get(version.versionId) ?? []
        const exposes = repos.map((repo) => ({
          id: edgeId('EXPOSES', alertId, repo.lockfileId),
          source: alertId,
          target: repo.lockfileId,
        }))
        await hydra.query(upsertEdgesQuery('EXPOSES', 'Alert', 'Lockfile'), {
          parameters: { edges: exposes },
        })
      }

      created = newAlerts.length
    }

    state.lastRunAt = new Date().toISOString()
    state.lastChecked = watched.length
    state.lastNew = created
    state.lastExisting = newKeys.size - created
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.lastError = message
    throw error
  }
  const elapsedMs = Date.now() - startedAt
  console.log(`[watch] checked ${state.lastChecked} versions, ${state.lastNew} new alerts (${elapsedMs}ms)`)
  return getWatchStatus()
}

async function fetchResolvingRepos(
  versionIds: number[]
): Promise<Map<number, Array<{ lockfileId: number }>>> {
  const result = new Map<number, Array<{ lockfileId: number }>>()
  if (versionIds.length === 0) return result
  const QUERY = `
    MATCH (l:Lockfile)-[r:RESOLVES]->(v:PackageVersion {id: $id})
    RETURN v.id AS versionId, l.id AS lockfileId
  `
  const batches = await mapLimit(versionIds, 8, async (versionId) => {
    const response = await hydra.query(QUERY, {
      parameters: { id: versionId },
      consistency: 'causal',
    })
    return rowsToObjects(response)
  })
  for (const rows of batches) {
    for (const row of rows) {
      const versionId = Number(row.versionId)
      const bucket = result.get(versionId) ?? []
      bucket.push({ lockfileId: Number(row.lockfileId) })
      result.set(versionId, bucket)
    }
  }
  return result
}

export async function getRecentIncidents(limit = 20): Promise<Incident[]> {
  const rows = rowsToObjects(
    await hydra.query(recentIncidentsQuery, { consistency: 'causal' })
  )
  const incidents = new Map<string, Incident>()
  for (const row of rows) {
    const key = `${row.advisoryId}:${row.package}@${row.version}`
    const existing = incidents.get(key)
    const repository = String(row.repository ?? '')
    const lockfile = String(row.lockfile ?? '')
    if (existing) {
      if (repository && !existing.repositories.includes(repository)) existing.repositories.push(repository)
      if (lockfile && !existing.lockfiles.includes(lockfile)) existing.lockfiles.push(lockfile)
      continue
    }
    incidents.set(key, {
      advisoryId: String(row.advisoryId),
      severity: String(row.severity ?? 'UNKNOWN'),
      summary: String(row.summary ?? ''),
      package: String(row.package ?? ''),
      version: String(row.version ?? ''),
      ecosystem: String(row.ecosystem ?? ''),
      fixedVersion: String(row.fixedVersions ?? ''),
      firstSeenAt: String(row.firstSeenAt ?? ''),
      repositories: repository ? [repository] : [],
      lockfiles: lockfile ? [lockfile] : [],
      exposurePath: [
        repository,
        lockfile,
        `${row.package}@${row.version}`,
        String(row.advisoryId),
      ].filter(Boolean),
    })
  }
  return [...incidents.values()].slice(0, limit)
}

function parseFixedVersions(json: string): Record<string, string> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

export type { Ecosystem }
