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
  /**
   * Security conclusion for this app:
   * - EXPOSED    — resolved the affected version while the advisory was live
   * - AT_RISK    — currently resolves an affected version, scan outside window
   * - NOT_AFFECTED — resolved the package but a version outside the affected range
   */
  conclusion: 'EXPOSED' | 'AT_RISK' | 'NOT_AFFECTED'
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
  conclusions: { exposed: string[]; atRisk: string[] }
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

  const apps: ExposureApp[] = rows.map((row) => {
    const scannedAt = String(row.scannedAt ?? '')
    const withinWindow = Boolean(
      scannedAt && publishedAt && modifiedAt && scannedAt >= publishedAt && scannedAt <= modifiedAt
    )
    return {
      repository: String(row.repository),
      lockfile: String(row.lockfile),
      kind: String(row.kind ?? ''),
      name: String(row.name),
      version: String(row.version),
      ecosystem: String(row.ecosystem ?? ''),
      requestedVersion: String(row.requestedVersion ?? ''),
      scannedAt,
      conclusion: withinWindow ? 'EXPOSED' : 'AT_RISK',
    }
  })

  const asOfFiltered = asOf ? apps.filter((app) => app.scannedAt && app.scannedAt <= asOf) : apps

  const exposedWhileLive = asOfFiltered.filter((app) => app.conclusion === 'EXPOSED')
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
    conclusions: {
      exposed: exposedWhileLive.map((app) => app.repository),
      atRisk: asOfFiltered
        .filter((app) => app.conclusion === 'AT_RISK')
        .map((app) => app.repository),
    },
    exposedWhileLive,
    currentlyAffected,
    affectedApps: [...new Set(asOfFiltered.map((app) => app.repository))].sort(),
  }
}
