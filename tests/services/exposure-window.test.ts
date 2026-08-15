import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'
import { getExposureWindow, parseAsOf } from '../../src/services/exposure-window.service'

let querySpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  querySpy?.mockRestore()
})

const str = (value: string) => ({ type: 'string' as const, value })

function appRow(repository: string, scannedAt: string, resolvedVersion = '4.17.20') {
  return [
    str('GHSA-test'),
    str('HIGH'),
    str('Prototype pollution'),
    str(repository),
    str(`${repository}/package-lock.json`),
    str('application'),
    str('lodash'),
    str(resolvedVersion),
    str('npm'),
    str('^4.17.0'),
    str(scannedAt),
    str('2021-01-01T00:00:00Z'),
    str('2021-05-01T00:00:00Z'),
  ]
}

function response(rows: QueryResponse['rows']): QueryResponse {
  return {
    query_id: 'q',
    columns: [
      'advisoryId', 'severity', 'summary', 'repository', 'lockfile', 'kind',
      'name', 'version', 'ecosystem', 'requestedVersion', 'scannedAt', 'publishedAt', 'modifiedAt',
    ],
    rows,
    read_epoch: 1,
    next_cursor: null,
    bookmark: null,
  }
}

describe('getExposureWindow', () => {
  it('partitions apps into exposed-while-live and currently affected', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValue(
      response([
        appRow('payments-api', '2021-02-01T10:00:00Z'),
        appRow('storefront', '2021-06-01T10:00:00Z'),
        appRow('legacy-service', ''),
      ])
    )

    const result = await getExposureWindow('GHSA-test')

    expect(result.window).toEqual({
      start: '2021-01-01T00:00:00Z',
      end: '2021-05-01T00:00:00Z',
      live: true,
    })
    expect(result.exposedWhileLive.map((app) => app.repository)).toEqual(['payments-api'])
    expect(result.currentlyAffected).toHaveLength(3)
    expect(result.affectedApps).toEqual(['legacy-service', 'payments-api', 'storefront'])
  })

  it('applies an as-of cutoff to ignore later resolutions', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValue(
      response([
        appRow('payments-api', '2021-02-01T10:00:00Z'),
        appRow('storefront', '2021-06-01T10:00:00Z'),
      ])
    )

    const result = await getExposureWindow('GHSA-test', '2021-03-01')

    expect(result.currentlyAffected.map((app) => app.repository)).toEqual(['payments-api'])
    expect(result.exposedWhileLive.map((app) => app.repository)).toEqual(['payments-api'])
  })
})

describe('parseAsOf', () => {
  it('normalizes a date to end-of-day ISO', () => {
    expect(parseAsOf('2021-03-01')).toBe('2021-03-01T23:59:59.999Z')
    expect(parseAsOf(undefined)).toBeUndefined()
    expect(parseAsOf('2021-03-01T00:00:00Z')).toBe('2021-03-01T00:00:00Z')
  })
})
