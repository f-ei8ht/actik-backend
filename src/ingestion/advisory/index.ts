import { fetchNpmAuditAdvisories } from './npm-audit'
import { fetchOsvAdvisories } from './osv'
import { fetchPypiAdvisories } from './pypi'
import type { AdvisoryPackage, AdvisoryRecord, AffectedPackage } from './types'

export function mergeAdvisories(records: AdvisoryRecord[]): AdvisoryRecord[] {
  const byId = new Map<string, AdvisoryRecord>()
  for (const record of records) {
    const existing = byId.get(record.node.advisoryId)
    if (!existing) {
      byId.set(record.node.advisoryId, {
        node: record.node,
        affected: record.affected.map((affected) => ({ ...affected, versions: [...affected.versions] })),
      })
      continue
    }
    const seen = new Set(
      existing.affected.flatMap((affected) =>
        affected.versions.map((version) => `${affected.ecosystem}:${affected.name}:${version}`)
      )
    )
    for (const affected of record.affected) {
      const match = existing.affected.find(
        (entry) => entry.ecosystem === affected.ecosystem && entry.name === affected.name
      )
      const target = match ?? { ecosystem: affected.ecosystem, name: affected.name, versions: [] as string[] }
      if (!match) existing.affected.push(target)
      for (const version of affected.versions) {
        const key = `${affected.ecosystem}:${affected.name}:${version}`
        if (seen.has(key)) continue
        seen.add(key)
        target.versions.push(version)
      }
    }
  }
  return [...byId.values()]
}

export async function fetchAdvisories(packages: AdvisoryPackage[]): Promise<AdvisoryRecord[]> {
  const npmPackages = packages.filter((pkg) => pkg.ecosystem === 'npm')
  const pypiPackages = packages.filter((pkg) => pkg.ecosystem === 'PyPI')

  const [osv, npmAudit, pypi] = await Promise.all([
    fetchOsvAdvisories(packages),
    fetchNpmAuditAdvisories(npmPackages),
    fetchPypiAdvisories(pypiPackages),
  ])
  return mergeAdvisories([...osv, ...npmAudit, ...pypi])
}

export type { AdvisoryPackage, AdvisoryRecord, AffectedPackage } from './types'
