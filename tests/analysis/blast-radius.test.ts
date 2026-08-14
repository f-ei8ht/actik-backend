import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'
import { computeBlastRadius } from '../../src/analysis/blast-radius'

let querySpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  querySpy?.mockRestore()
})

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

function idResponse(id: number): QueryResponse {
  return {
    query_id: 'q',
    columns: ['id'],
    rows: [[{ type: 'vertex_id', value: id }]],
    read_epoch: 1,
    next_cursor: null,
    bookmark: null,
  }
}

function resolutionResponse(rows: QueryResponse['rows']): QueryResponse {
  return {
    query_id: 'q',
    columns: ['repository', 'lockfile', 'commitSha', 'kind', 'requestedVersion', 'resolvedVersion'],
    rows,
    read_epoch: 1,
    next_cursor: null,
    bookmark: null,
  }
}

const str = (value: string) => ({ type: 'string' as const, value })

describe('computeBlastRadius', () => {
  it('separates direct and transitive dependents from paths', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy
      .mockResolvedValueOnce(idResponse(1))
      .mockResolvedValueOnce(
        pathResponse([
          [node(1, 'lodash', '4.17.20'), node(2, 'express', '4.18.2')],
          [node(1, 'lodash', '4.17.20'), node(4, 'hono', '4.13.1')],
          [node(1, 'lodash', '4.17.20'), node(2, 'express', '4.18.2'), node(3, 'next', '14.0.0')],
        ])
      )
      .mockResolvedValue(resolutionResponse([]))

    const result = await computeBlastRadius('lodash', '4.17.20')

    expect(result).not.toBeNull()
    expect(result?.directDependents.map((d) => d.name).sort()).toEqual(['express', 'hono'])
    expect(result?.transitiveDependents.map((d) => d.name).sort()).toEqual(['express', 'hono', 'next'])
    expect(result?.maxDepth).toBe(2)
    expect(result?.count).toBe(3)
    expect(result?.paths).toHaveLength(3)
    expect(result?.paths[0].path[0]).toBe('express@4.18.2')
    expect(result?.affectedRepositories).toEqual([])
    expect(result?.resolutions).toEqual([])
  })

  it('collects affected repositories and applications from RESOLVES evidence', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy
      .mockResolvedValueOnce(idResponse(1))
      .mockResolvedValueOnce(
        pathResponse([[node(1, 'lodash', '4.17.20'), node(2, 'express', '4.18.2')]])
      )
      .mockResolvedValueOnce(resolutionResponse([]))
      .mockResolvedValue(
        resolutionResponse([
          [str('payments-api'), str('payments-api/package-lock.json'), str('abc'), str('application'), str('^4.17.0'), str('4.17.20')],
          [str('storefront'), str('storefront/package-lock.json'), str('abc'), str('application'), str('^4.17.0'), str('4.17.20')],
          [str('notification-service'), str('notification-service/package-lock.json'), str('abc'), str('service'), str('^4.17.0'), str('4.17.20')],
        ])
      )

    const result = await computeBlastRadius('lodash', '4.17.20')

    expect(result?.affectedRepositories).toEqual(['notification-service', 'payments-api', 'storefront'])
    expect(result?.applications).toEqual(['payments-api', 'storefront'])
    expect(result?.resolutions).toHaveLength(3)
    expect(result?.resolutions[0]).toMatchObject({
      repository: 'notification-service',
      lockfile: 'notification-service/package-lock.json',
      commitSha: 'abc',
      requestedVersion: '^4.17.0',
      resolvedVersion: '4.17.20',
    })
  })

  it('deduplicates direct dependents by node id, not by name', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy
      .mockResolvedValueOnce(idResponse(1))
      .mockResolvedValueOnce(
        pathResponse([
          [node(1, 'lodash', '4.17.20'), node(2, 'foo', '1.0.0')],
          [node(1, 'lodash', '4.17.20'), node(5, 'foo', '2.0.0')],
        ])
      )
      .mockResolvedValue(resolutionResponse([]))

    const result = await computeBlastRadius('lodash', '4.17.20')

    expect(result?.directDependents).toEqual([
      { name: 'foo', version: '1.0.0' },
      { name: 'foo', version: '2.0.0' },
    ])
  })

  it('passes ecosystem to the version lookup when provided', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValueOnce(idResponse(1)).mockResolvedValue(pathResponse([]))

    await computeBlastRadius('requests', '2.31.0', 'PyPI')

    expect(querySpy.mock.calls[0][1]?.parameters).toMatchObject({ name: 'requests', version: '2.31.0', ecosystem: 'PyPI' })
    expect(querySpy.mock.calls[0][0]).toContain('v.ecosystem = $ecosystem')
  })

  it('returns null when the version does not exist', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValueOnce({
      query_id: 'q',
      columns: ['id'],
      rows: [],
      read_epoch: 1,
      next_cursor: null,
      bookmark: null,
    })

    expect(await computeBlastRadius('nope', '1.0.0')).toBeNull()
  })
})
