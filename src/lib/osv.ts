import { env } from './config'
import type { OsvVulnDoc } from '../ingestion/version'

export interface OsvVersionQuery {
  package: { ecosystem: string; name: string }
  version: string
}

const QUERY_CHUNK = 100

/**
 * Query OSV for the advisory ids affecting each (package, version). Each entry
 * of the result corresponds to an entry in `queries`.
 */
export async function queryOsvVersions(queries: OsvVersionQuery[]): Promise<Array<string[]>> {
  const baseUrl = env.OSV_API_URL.replace(/\/+$/, '')
  const result: Array<string[]> = new Array(queries.length).fill([])
  for (let offset = 0; offset < queries.length; offset += QUERY_CHUNK) {
    const slice = queries.slice(offset, offset + QUERY_CHUNK)
    const response = await fetch(`${baseUrl}/v1/querybatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: slice }),
    })
    if (!response.ok) throw new Error(`OSV querybatch ${response.status}: ${await response.text()}`)
    const doc = (await response.json()) as { results?: Array<{ vulns?: Array<{ id?: string }> }> }
    for (let i = 0; i < slice.length; i++) {
      result[offset + i] = (doc.results?.[i]?.vulns ?? [])
        .map((vuln) => vuln?.id)
        .filter((id): id is string => Boolean(id))
    }
  }
  return result
}

export async function fetchOsvVuln(id: string): Promise<OsvVulnDoc | null> {
  const baseUrl = env.OSV_API_URL.replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/v1/vulns/${encodeURIComponent(id)}`)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`OSV vuln ${response.status} for ${id}: ${await response.text()}`)
  }
  return (await response.json()) as OsvVulnDoc
}
