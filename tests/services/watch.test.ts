import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'
import { getRecentIncidents, getWatchStatus } from '../../src/services/watch.service'

let querySpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  querySpy?.mockRestore()
})

const str = (value: string) => ({ type: 'string' as const, value })

function response(rows: QueryResponse['rows']): QueryResponse {
  return {
    query_id: 'q',
    columns: [
      'advisoryId', 'severity', 'summary', 'package', 'version', 'ecosystem',
      'fixedVersions', 'firstSeenAt', 'repository', 'lockfile',
    ],
    rows,
    read_epoch: 1,
    next_cursor: null,
    bookmark: null,
  }
}

describe('getRecentIncidents', () => {
  it('returns incidents with exposure paths from Alert->EXPOSES edges', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValue(
      response([
        [
          str('GHSA-new'),
          str('CRITICAL'),
          str('RCE in example'),
          str('example'),
          str('1.2.3'),
          str('npm'),
          str('1.2.4'),
          str('2026-05-14T09:06:00Z'),
          str('payments-api'),
          str('payments-api/package-lock.json'),
        ],
        [
          str('GHSA-new'),
          str('CRITICAL'),
          str('RCE in example'),
          str('example'),
          str('1.2.3'),
          str('npm'),
          str('1.2.4'),
          str('2026-05-14T09:06:00Z'),
          str('storefront'),
          str('storefront/package-lock.json'),
        ],
      ])
    )

    const incidents = await getRecentIncidents()

    expect(incidents).toHaveLength(1)
    const incident = incidents[0]
    expect(incident.advisoryId).toBe('GHSA-new')
    expect(incident.severity).toBe('CRITICAL')
    expect(incident.fixedVersion).toBe('1.2.4')
    expect(incident.firstSeenAt).toBe('2026-05-14T09:06:00Z')
    expect(incident.repositories).toEqual(['payments-api', 'storefront'])
    expect(incident.exposurePath).toEqual([
      'payments-api',
      'payments-api/package-lock.json',
      'example@1.2.3',
      'GHSA-new',
    ])
  })
})

describe('getWatchStatus', () => {
  it('returns an empty status before the first run', () => {
    expect(getWatchStatus()).toMatchObject({
      lastRunAt: null,
      lastError: null,
    })
  })
})
