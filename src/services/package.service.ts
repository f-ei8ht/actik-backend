import { hydra, rowsToObjects } from '../hydra/client'
import {
  advisoryCountForPackageQuery,
  dependenciesQuery,
  dependentsQuery,
  packageByNameQuery,
  versionCountQuery,
  versionDetailsQuery,
  versionsOfPackageQuery,
} from '../hydra/queries'
import { notFound } from '../lib/errors'

export interface PackageOverview {
  name: string
  ecosystem: string
  versions: number
  advisories: number
}

export interface VersionDetails {
  name: string
  version: string
  ecosystem: string
}

export interface VersionRelationships {
  dependencies: VersionDetails[]
  dependents: VersionDetails[]
}

export async function getPackageOverview(name: string): Promise<PackageOverview> {
  const packageRows = rowsToObjects(
    await hydra.query(packageByNameQuery, { parameters: { name }, consistency: 'causal' })
  )
  if (packageRows.length === 0) throw notFound(`package '${name}' not found`)
  const [versionCount] = rowsToObjects(
    await hydra.query(versionCountQuery, { parameters: { name }, consistency: 'causal' })
  )
  const [advisoryCount] = rowsToObjects(
    await hydra.query(advisoryCountForPackageQuery, { parameters: { name }, consistency: 'causal' })
  )
  return {
    name: String(packageRows[0].name),
    ecosystem: String(packageRows[0].ecosystem),
    versions: Number(versionCount?.count ?? 0),
    advisories: Number(advisoryCount?.count ?? 0),
  }
}

export async function listVersions(name: string): Promise<string[]> {
  const rows = rowsToObjects(
    await hydra.query(versionsOfPackageQuery, { parameters: { name }, consistency: 'causal' })
  )
  return rows.map((row) => String(row.version))
}

export async function getVersionDetails(name: string, version: string): Promise<VersionDetails> {
  const rows = rowsToObjects(
    await hydra.query(versionDetailsQuery, {
      parameters: { name, version },
      consistency: 'causal',
    })
  )
  if (rows.length === 0) throw notFound(`${name}@${version} not found`)
  return {
    name: String(rows[0].name),
    version: String(rows[0].version),
    ecosystem: String(rows[0].ecosystem),
  }
}

export async function getVersionRelationships(
  name: string,
  version: string
): Promise<VersionRelationships> {
  const dependencies = rowsToObjects(
    await hydra.query(dependenciesQuery, { parameters: { name, version }, consistency: 'causal' })
  )
  const dependents = rowsToObjects(
    await hydra.query(dependentsQuery, { parameters: { name, version }, consistency: 'causal' })
  )
  return {
    dependencies: dependencies.map(toVersionDetails),
    dependents: dependents.map(toVersionDetails),
  }
}

function toVersionDetails(row: Record<string, unknown>): VersionDetails {
  return {
    name: String(row.name),
    version: String(row.version),
    ecosystem: String(row.ecosystem ?? ''),
  }
}
