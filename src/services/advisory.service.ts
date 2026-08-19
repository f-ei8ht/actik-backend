import { hydra, rowsToObjects } from '../hydra/client'
import {
  advisoryAffectedVersionsQuery,
  advisoryByIdQuery,
  advisoriesForVersionQuery,
} from '../hydra/queries'
import { notFound } from '../lib/errors'
import type { VersionDetails } from './package.service'

export interface AdvisoryDetails {
  id: string
  severity: string
  summary: string
  publishedAt: string
  modifiedAt: string
  references: string
  fixedVersions: Record<string, string>
  introducedVersions: Record<string, string>
  affectedVersions: VersionDetails[]
}

function decodeJsonMap(value: unknown): Record<string, string> {
  if (typeof value !== 'string' || value === '') return {}
  try {
    return JSON.parse(value) as Record<string, string>
  } catch {
    return {}
  }
}

export async function getAdvisory(id: string): Promise<AdvisoryDetails> {
  const rows = rowsToObjects(
    await hydra.query(advisoryByIdQuery, { parameters: { id }, consistency: 'causal' })
  )
  if (rows.length === 0) throw notFound(`advisory '${id}' not found`)

  const affectedRows = rowsToObjects(
    await hydra.query(advisoryAffectedVersionsQuery, {
      parameters: { id },
      consistency: 'causal',
    })
  )

  return {
    id: String(rows[0].id),
    severity: String(rows[0].severity),
    summary: String(rows[0].summary),
    publishedAt: String(rows[0].publishedAt ?? ''),
    modifiedAt: String(rows[0].modifiedAt ?? ''),
    references: String(rows[0].references ?? ''),
    fixedVersions: decodeJsonMap(rows[0].fixedVersions),
    introducedVersions: decodeJsonMap(rows[0].introducedVersions),
    affectedVersions: affectedRows.map((row) => ({
      name: String(row.name),
      version: String(row.version),
      ecosystem: String(row.ecosystem ?? ''),
    })),
  }
}

export async function getAdvisoriesForVersion(
  name: string,
  version: string,
  ecosystem?: string
): Promise<AdvisoryDetails[]> {
  const rows = rowsToObjects(
    await hydra.query(advisoriesForVersionQuery(ecosystem), {
      parameters: { name, version, ...(ecosystem ? { ecosystem } : {}) },
      consistency: 'causal',
    })
  )
  return rows.map((row) => ({
    id: String(row.id),
    severity: String(row.severity),
    summary: String(row.summary),
    publishedAt: String(row.publishedAt ?? ''),
    modifiedAt: String(row.modifiedAt ?? ''),
    references: '',
    fixedVersions: decodeJsonMap(row.fixedVersions),
    introducedVersions: decodeJsonMap(row.introducedVersions),
    affectedVersions: [],
  }))
}
