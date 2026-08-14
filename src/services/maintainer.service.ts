import { hydra, rowsToObjects } from '../hydra/client'
import { maintainersOfPackageQuery, sharedMaintainersQuery } from '../hydra/queries'
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
