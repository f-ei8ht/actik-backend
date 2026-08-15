import { hydra, rowsToObjects } from '../hydra/client'
import {
  maintainersOfPackageQuery,
  repositoriesForPackageQuery,
  sharedMaintainersQuery,
} from '../hydra/queries'
import { notFound } from '../lib/errors'
import { groupSharedMaintainers, type MaintainerGroup } from '../analysis/maintainers'

export interface SharedMaintainerLink {
  package: string
  maintainer: string
}

export async function getMaintainers(name: string, ecosystem?: string): Promise<string[]> {
  const rows = rowsToObjects(
    await hydra.query(maintainersOfPackageQuery(ecosystem), {
      parameters: { name, ...(ecosystem ? { ecosystem } : {}) },
      consistency: 'causal',
    })
  )
  if (rows.length === 0) throw notFound(`package '${name}' not found`)
  return rows.map((row) => String(row.name))
}

export async function getSharedMaintainers(name: string, ecosystem?: string): Promise<MaintainerGroup[]> {
  const rows = rowsToObjects(
    await hydra.query(sharedMaintainersQuery(ecosystem), {
      parameters: { name, ...(ecosystem ? { ecosystem } : {}) },
      consistency: 'causal',
    })
  )
  return groupSharedMaintainers(
    rows.map((row) => ({
      package: String(row.name),
      maintainer: String(row.maintainer),
    }))
  )
}

export interface MaintainerRiskPackage {
  package: string
  ecosystem: string
  maintainers: string[]
  repositories: string[]
  versions: string[]
}

export interface MaintainerRisk {
  package: string
  ecosystem: string
  maintainers: string[]
  controlledPackages: MaintainerRiskPackage[]
  totalPackages: number
  presentInRepositories: number
}

/**
 * One level deeper than shared maintainers: a compromised package's
 * maintainers also control N other packages — which of those are present in
 * real repositories? ("the compromised maintainer also ships to 7 packages,
 * 3 of which sit inside your org")
 */
export async function getMaintainerRisk(name: string, ecosystem?: string): Promise<MaintainerRisk> {
  const maintainers = await getMaintainers(name, ecosystem)
  const groups = await getSharedMaintainers(name, ecosystem)
  const controlledNames = [...new Set(groups.flatMap((group) => group.packages))].sort()

  const controlledPackages: MaintainerRiskPackage[] = []
  for (const packageName of controlledNames) {
    const rows = rowsToObjects(
      await hydra.query(repositoriesForPackageQuery(ecosystem), {
        parameters: { name: packageName, ...(ecosystem ? { ecosystem } : {}) },
        consistency: 'causal',
      })
    )
    const repositories = [...new Set(rows.map((row) => String(row.repository)))].sort()
    const versions = [...new Set(rows.map((row) => String(row.version)))].sort()
    controlledPackages.push({
      package: packageName,
      ecosystem: ecosystem ?? '',
      maintainers: groups
        .filter((group) => group.packages.includes(packageName))
        .map((group) => group.maintainer),
      repositories,
      versions,
    })
  }

  return {
    package: name,
    ecosystem: ecosystem ?? '',
    maintainers,
    controlledPackages: controlledPackages.sort((a, b) => b.repositories.length - a.repositories.length),
    totalPackages: controlledPackages.length,
    presentInRepositories: controlledPackages.filter((entry) => entry.repositories.length > 0).length,
  }
}
