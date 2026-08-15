import { hydra, rowsToObjects } from '../hydra/client'
import { exposureWindowForAdvisoryQuery } from '../hydra/queries'
import { notFound } from '../lib/errors'

export interface ExposureApp {
  repository: string
  lockfile: string
  kind: string
  name: string
  version: string
  ecosystem: string
  requestedVersion: string
  scannedAt: string
}

export interface ExposureWindowResult {
  advisory: {
    id: string
    severity: string
    summary: string
    publishedAt: string
    modifiedAt: string
  }
  window: { start: string; end: string; live: boolean }
  exposedWhileLive: ExposureApp[]
  currentlyAffected: ExposureApp[]
  affectedApps: string[]
}

export function parseAsOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const asDate = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(asDate)) return `${asDate}T23:59:59.999Z`
  return asDate
}

export async function getExposureWindow(
  id: string,
  asOfRaw?: string
): Promise<ExposureWindowResult> {
  const rows = rowsToObjects(
    await hydra.query(exposureWindowForAdvisoryQuery, {
      parameters: { id },
      consistency: 'causal',
    })
  )
  if (rows.length === 0) throw notFound(`advisory '${id}' not found or has no resolvers`)

  const asOf = parseAsOf(asOfRaw)
  const first = rows[0]
  const publishedAt = String(first.publishedAt ?? '')
  const modifiedAt = String(first.modifiedAt ?? '')
  const end = modifiedAt || publishedAt

  const apps: ExposureApp[] = rows.map((row) => ({
    repository: String(row.repository),
    lockfile: String(row.lockfile),
    kind: String(row.kind ?? ''),
    name: String(row.name),
    version: String(row.version),
    ecosystem: String(row.ecosystem ?? ''),
    requestedVersion: String(row.requestedVersion ?? ''),
    scannedAt: String(row.scannedAt ?? ''),
  }))

  const asOfFiltered = asOf ? apps.filter((app) => app.scannedAt && app.scannedAt <= asOf) : apps

  const exposedWhileLive = asOfFiltered.filter(
    (app) =>
      app.scannedAt &&
      publishedAt &&
      modifiedAt &&
      app.scannedAt >= publishedAt &&
      app.scannedAt <= modifiedAt
  )

  const currentlyAffected = asOfFiltered

  return {
    advisory: {
      id: String(first.advisoryId ?? id),
      severity: String(first.severity ?? 'UNKNOWN'),
      summary: String(first.summary ?? ''),
      publishedAt,
      modifiedAt,
    },
    window: {
      start: publishedAt,
      end,
      live: Boolean(publishedAt && modifiedAt),
    },
    exposedWhileLive,
    currentlyAffected,
    affectedApps: [...new Set(asOfFiltered.map((app) => app.repository))].sort(),
  }
}
