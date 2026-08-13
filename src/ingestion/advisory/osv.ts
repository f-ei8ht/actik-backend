import { env } from '../../lib/config'
import { affectedPackages, isAffectedVersion, normalizeAdvisory } from '../normalize'
import { advisoryNodeId } from '../types'
import type { AdvisoryNode } from '../types'
import type { OsvVulnDoc } from '../version'
import type { AdvisoryPackage, AdvisoryRecord } from './types'

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

async function fetchVulnDetail(id: string, baseUrl: string): Promise<OsvVulnDoc | null> {
  const response = await fetch(`${baseUrl}/v1/vulns/${encodeURIComponent(id)}`)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`OSV vuln ${response.status} for ${id}: ${await response.text()}`)
  }
  return (await response.json()) as OsvVulnDoc
}

export async function fetchOsvAdvisories(packages: AdvisoryPackage[]): Promise<AdvisoryRecord[]> {
  if (packages.length === 0) return []
  const baseUrl = env.OSV_API_URL.replace(/\/+$/, '')

  const versionsByPackage = new Map(packages.map((pkg) => [`${pkg.ecosystem}:${pkg.name}`, pkg.versions]))
  const queries = packages.map((pkg) => ({
    package: { ecosystem: pkg.ecosystem, name: pkg.name },
  }))

  const response = await fetch(`${baseUrl}/v1/querybatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries }),
  })
  if (!response.ok) {
    throw new Error(`OSV querybatch ${response.status}: ${await response.text()}`)
  }
  const doc = (await response.json()) as { results?: Array<{ vulns?: OsvVulnDoc[] }> }

  const ids = new Set<string>()
  for (const result of doc.results ?? []) {
    for (const vuln of result.vulns ?? []) {
      if (vuln?.id) ids.add(vuln.id)
    }
  }

  const limited = [...ids].slice(0, env.INGESTION_MAX_ADVISORIES)
  const details = await mapLimit(limited, env.INGESTION_CONCURRENCY, async (id) =>
    fetchVulnDetail(id, baseUrl)
  )

  const records: AdvisoryRecord[] = []
  for (const detail of details) {
    if (!detail?.id || detail.withdrawn) continue
    const affected = []
    for (const { ecosystem, name } of affectedPackages(detail)) {
      const versions = (versionsByPackage.get(`${ecosystem}:${name}`) ?? []).filter((version) =>
        isAffectedVersion(detail, ecosystem, name, version)
      )
      if (versions.length === 0) continue
      affected.push({ ecosystem, name, versions })
    }
    if (affected.length === 0) continue
    records.push({ node: normalizeAdvisory(detail), affected })
  }
  return records
}
