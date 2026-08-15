import { queryOsvVersions, fetchOsvVuln } from '../lib/osv'
import { normalizeAdvisory } from '../ingestion/normalize'
import { firstFixedVersion } from '../ingestion/version'
import type { ScanFinding, ResolvedDepRef } from './exposure'
import type { OsvVulnDoc } from '../ingestion/version'

const OSV_BATCH = 100
const DETAIL_CONCURRENCY = 8

export interface OsvFindingInput {
  dep: ResolvedDepRef
  advisory: OsvVulnDoc
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

function fixCommand(ecosystem: string, name: string, fixed: string): string {
  return ecosystem === 'npm' ? `npm install ${name}@${fixed}` : `pip install ${name}==${fixed}`
}

/**
 * Live OSV check: given every version a repo resolves, return findings for any
 * advisory OSV reports against that exact version. Fills the coverage gap of
 * the ingested package graph so a scan is useful on any lockfile, not just
 * seeded packages.
 */
export async function fetchOsvFindings(
  deps: ResolvedDepRef[],
  repoLabel: string,
  skipKeys: Set<string> = new Set()
): Promise<ScanFinding[]> {
  if (deps.length === 0) return []

  const queries = deps.map((dep) => ({
    package: { ecosystem: dep.ecosystem, name: dep.name },
    version: dep.resolvedVersion,
  }))
  const vulnIdsPerDep = await queryOsvVersions(queries)

  const inputs: OsvFindingInput[] = []
  const seenDetails = new Set<string>()
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i]
    for (const advisoryId of vulnIdsPerDep[i]) {
      const key = `${advisoryId}:${dep.name}@${dep.resolvedVersion}`
      if (skipKeys.has(key)) continue
      seenDetails.add(advisoryId)
      inputs.push({ dep, advisory: { id: advisoryId } as OsvVulnDoc })
    }
  }

  const docs = await mapLimit([...seenDetails], DETAIL_CONCURRENCY, (id) => fetchOsvVuln(id))
  const docById = new Map<string, OsvVulnDoc>()
  for (const doc of docs) if (doc?.id) docById.set(doc.id, doc)

  const findings: ScanFinding[] = []
  for (const input of inputs) {
    const doc = docById.get(input.advisory.id)
    if (!doc?.id || doc.withdrawn) continue
    const advisory = normalizeAdvisory(doc)
    const fixedVersions = parseFixedVersions(advisory.fixedVersions)
    const fixedVersion = fixedVersions[input.dep.name] ?? null
    findings.push({
      package: input.dep.name,
      ecosystem: input.dep.ecosystem,
      resolvedVersion: input.dep.resolvedVersion,
      requestedVersion: input.dep.requestedVersion,
      severity: advisory.severity,
      advisory: {
        id: doc.id,
        summary: advisory.summary,
        publishedAt: advisory.publishedAt,
        modifiedAt: advisory.modifiedAt,
        references: advisory.references,
      },
      fix:
        fixedVersion && fixedVersion !== input.dep.resolvedVersion
          ? fixCommand(input.dep.ecosystem, input.dep.name, fixedVersion)
          : null,
      fixedVersion:
        fixedVersion && fixedVersion !== input.dep.resolvedVersion ? fixedVersion : undefined,
      source: 'osv',
      paths: [[repoLabel, input.dep.lockfilePath, `${input.dep.name}@${input.dep.resolvedVersion}`]],
      depth: 0,
    })
  }

  return findings
}

function parseFixedVersions(json: string): Record<string, string> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

export { OSV_BATCH }
