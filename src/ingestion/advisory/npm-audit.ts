import { env } from '../../lib/config'
import { advisoryNodeId } from '../types'
import type { AdvisoryNode } from '../types'
import { testNpmRange } from '../version'
import type { AdvisoryPackage, AdvisoryRecord } from './types'

interface NpmAuditAdvisory {
  id: number | string
  severity?: string
  title?: string
  url?: string
  vulnerable_versions?: string
}

interface NpmAuditResponse {
  [packageName: string]: NpmAuditAdvisory[]
}

export async function fetchNpmAuditAdvisories(packages: AdvisoryPackage[]): Promise<AdvisoryRecord[]> {
  const npmPackages = packages.filter((pkg) => pkg.ecosystem === 'npm')
  if (npmPackages.length === 0) return []

  const body: Record<string, string[]> = {}
  for (const pkg of npmPackages) {
    body[pkg.name] = pkg.versions
  }

  const response = await fetch(
    `${env.NPM_REGISTRY_URL.replace(/\/+$/, '')}/-/npm/v1/security/advisories/bulk`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  if (!response.ok) {
    throw new Error(`npm bulk audit ${response.status}: ${await response.text()}`)
  }
  const data = (await response.json()) as NpmAuditResponse

  const records: AdvisoryRecord[] = []
  for (const [name, advisories] of Object.entries(data)) {
    const packageVersions = npmPackages.find((pkg) => pkg.name === name)?.versions ?? []
    for (const advisory of advisories ?? []) {
      if (!advisory.id) continue
      const node: AdvisoryNode = {
        id: advisoryNodeId(`npm:${advisory.id}`),
        advisoryId: `npm-audit-${advisory.id}`,
        severity: (advisory.severity ?? 'unknown').toUpperCase(),
        summary: advisory.title ?? advisory.url ?? `npm advisory ${advisory.id}`,
        publishedAt: '',
        modifiedAt: '',
        references: advisory.url ?? '',
      }
      const versions = packageVersions.filter((version) =>
        testNpmRange(advisory.vulnerable_versions, version)
      )
      if (versions.length === 0) continue
      records.push({
        node,
        affected: [{ ecosystem: 'npm', name, versions }],
      })
    }
  }
  return records
}
