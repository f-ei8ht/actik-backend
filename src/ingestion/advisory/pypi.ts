import { env } from '../../lib/config'
import { advisoryNodeId } from '../types'
import type { AdvisoryNode } from '../types'
import type { AdvisoryPackage, AdvisoryRecord } from './types'

interface PypiVulnerability {
  id?: string
  aliases?: string[]
  details?: string
  summary?: string | null
  fixed_in?: string[]
  link?: string
  withdrawn?: string | null
}

interface PypiReleaseDoc {
  info?: { version?: string }
  vulnerabilities?: PypiVulnerability[]
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

export async function fetchPypiAdvisories(packages: AdvisoryPackage[]): Promise<AdvisoryRecord[]> {
  const pypiPackages = packages.filter((pkg) => pkg.ecosystem === 'PyPI')
  if (pypiPackages.length === 0) return []

  const baseUrl = env.PYPI_JSON_URL.replace(/\/+$/, '')
  const tasks: Array<{ name: string; version: string }> = []
  for (const pkg of pypiPackages) {
    for (const version of pkg.versions) {
      tasks.push({ name: pkg.name, version })
    }
  }

  const records: AdvisoryRecord[] = []
  await mapLimit(tasks, env.INGESTION_CONCURRENCY, async (task) => {
    const response = await fetch(
      `${baseUrl}/${encodeURIComponent(task.name)}/${encodeURIComponent(task.version)}/json`
    )
    if (!response.ok) return
    const doc = (await response.json()) as PypiReleaseDoc
    for (const vulnerability of doc.vulnerabilities ?? []) {
      if (!vulnerability.id || vulnerability.withdrawn) continue
      const node: AdvisoryNode = {
        id: advisoryNodeId(vulnerability.id),
        advisoryId: vulnerability.id,
        severity: 'UNKNOWN',
        summary: vulnerability.summary ?? vulnerability.details ?? vulnerability.id,
        publishedAt: '',
        references: vulnerability.link ?? '',
      }
      records.push({
        node,
        affected: [{ ecosystem: 'PyPI', name: task.name, versions: [task.version] }],
      })
    }
  })

  return records
}
