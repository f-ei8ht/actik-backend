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

    const result = await computeBlastRadius('lodash', '4.17.20')

    expect(result).not.toBeNull()
    expect(result?.directDependents.map((d) => d.name).sort()).toEqual(['express', 'hono'])
    expect(result?.transitiveDependents.map((d) => d.name).sort()).toEqual(['express', 'hono', 'next'])
    expect(result?.maxDepth).toBe(2)
    expect(result?.count).toBe(3)
    expect(result?.paths).toHaveLength(3)
    expect(result?.paths[0].path[0]).toBe('express@4.18.2')
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
