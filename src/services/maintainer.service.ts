import { hydra, rowsToObjects } from '../hydra/client'
import { maintainersOfPackageQuery, sharedMaintainersQuery } from '../hydra/queries'
import { notFound } from '../lib/errors'

export interface SharedMaintainerLink {
  package: string
  maintainer: string
}

export async function getMaintainers(name: string): Promise<string[]> {
  const rows = rowsToObjects(
    await hydra.query(maintainersOfPackageQuery, { parameters: { name }, consistency: 'causal' })
  )
  if (rows.length === 0) throw notFound(`package '${name}' not found`)
  return rows.map((row) => String(row.name))
}

export async function getSharedMaintainers(name: string): Promise<SharedMaintainerLink[]> {
  const rows = rowsToObjects(
    await hydra.query(sharedMaintainersQuery, { parameters: { name }, consistency: 'causal' })
  )
  return rows.map((row) => ({
    package: String(row.name),
    maintainer: String(row.maintainer),
  }))
}
