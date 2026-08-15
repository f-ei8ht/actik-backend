import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'
import { simulatePropagation } from '../../src/analysis/propagation'

let querySpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  querySpy?.mockRestore()
})

const str = (value: string) => ({ type: 'string' as const, value })
const num = (value: number) => ({ type: 'integer' as const, value })
const vertex = (value: number) => ({ type: 'vertex_id' as const, value })

function response(columns: string[], rows: QueryResponse['rows']): QueryResponse {
  return {
    query_id: 'q',
    columns,
    rows,
    read_epoch: 1,
    next_cursor: null,
    bookmark: null,
  }
}

function node(id: number, name: string, version: string) {
  return {
    id,
    labels: ['PackageVersion'],
    properties: { name: { String: name }, version: { String: version }, ecosystem: { String: 'npm' } },
  }
}

function pathResponse(paths: unknown[][]): QueryResponse {
  return {
    query_id: 'q',
    columns: ['path'],
    rows: paths.map((nodes) => [{ type: 'path', value: { nodes, relationships: [] } }]),
    read_epoch: 1,
    next_cursor: null,
    bookmark: null,
  }
}

describe('simulatePropagation', () => {
  it('computes per-app time-to-exposure from DEPENDS_ON depth', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockImplementation((query: string) => {
      if (query.includes('algo.SSpaths')) {
        return Promise.resolve(
          pathResponse([
            [node(1, 'lodash', '4.17.20'), node(2, 'express', '4.18.2')],
            [node(1, 'lodash', '4.17.20'), node(2, 'express', '4.18.2'), node(3, 'next', '14.0.0')],
          ])
        )
      }
      if (query.includes('RETURN l.repository AS repository')) {
        return Promise.resolve(
          response(
            ['repository', 'lockfile', 'kind', 'versionId', 'name', 'version'],
            [
              [str('payments-api'), str('payments-api/package-lock.json'), str('application'), num(2), str('express'), str('4.18.2')],
              [str('storefront'), str('storefront/package-lock.json'), str('application'), num(3), str('next'), str('14.0.0')],
            ]
          )
        )
      }
      return Promise.resolve(response(['id'], [[vertex(1)]]))
    })

    const result = await simulatePropagation('lodash', '4.17.20', 'npm', {
      compromisedAt: '2026-05-14T09:00:00Z',
      perHopMs: 6 * 60 * 1000,
    })

    expect(result).not.toBeNull()
    expect(result?.apps).toHaveLength(2)
    expect(result?.apps[0]).toMatchObject({
      repository: 'payments-api',
      depth: 1,
      direct: false,
      exposedAt: '2026-05-14T09:06:00.000Z',
    })
    expect(result?.apps[0].chain).toEqual(['express@4.18.2', 'lodash@4.17.20'])
    expect(result?.apps[1]).toMatchObject({
      repository: 'storefront',
      depth: 2,
      exposedAt: '2026-05-14T09:12:00.000Z',
    })
    expect(result?.maxDepth).toBe(2)
    expect(result?.firstExposedAt).toBe('2026-05-14T09:06:00.000Z')
    expect(result?.lastExposedAt).toBe('2026-05-14T09:12:00.000Z')
    expect(result?.spanMs).toBe(6 * 60 * 1000)
    expect(result?.timeline[0]).toEqual({
      exposedAt: '2026-05-14T09:06:00.000Z',
      repository: 'payments-api',
      depth: 1,
    })
  })

  it('flags apps resolving the compromised version directly as exposed at t=0', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockImplementation((query: string) => {
      if (query.includes('algo.SSpaths')) {
        return Promise.resolve(pathResponse([[node(1, 'lodash', '4.17.20')]]))
      }
      if (query.includes('RETURN l.repository AS repository')) {
        return Promise.resolve(
          response(
            ['repository', 'lockfile', 'kind', 'versionId', 'name', 'version'],
            [[str('legacy'), str('legacy/package-lock.json'), str('application'), num(1), str('lodash'), str('4.17.20')]]
          )
        )
      }
      return Promise.resolve(response(['id'], [[vertex(1)]]))
    })

    const result = await simulatePropagation('lodash', '4.17.20', 'npm', {
      compromisedAt: '2026-05-14T09:00:00Z',
    })

    expect(result?.apps[0]).toMatchObject({ repository: 'legacy', depth: 0, direct: true })
    expect(result?.apps[0].exposedAt).toBe('2026-05-14T09:00:00.000Z')
    expect(result?.directApps).toBe(1)
    expect(result?.transitiveApps).toBe(0)
  })

  it('returns null when the version does not exist', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValue(response(['id'], []))
    expect(await simulatePropagation('nope', '1.0.0')).toBeNull()
  })
})
