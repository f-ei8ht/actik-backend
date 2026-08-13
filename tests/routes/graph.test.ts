import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'
import graph from '../../src/routes/graph'

function envelope(columns: string[], rows: QueryResponse['rows']): QueryResponse {
  return {
    query_id: 'q',
    columns,
    rows,
    read_epoch: 1,
    next_cursor: null,
    bookmark: null,
  }
}

const empty = envelope([], [])

const idRow = (id: number): QueryResponse['rows'] => [[{ type: 'vertex_id', value: id }]]

function pathRow(path: ReturnType<typeof node>[]): QueryResponse['rows'] {
  return [[{ type: 'path', value: { nodes: path, relationships: [] } }]]
}

function node(id: number, name: string, version: string) {
  return {
    id,
    labels: ['PackageVersion'],
    properties: {
      name: { String: name },
      version: { String: version },
      ecosystem: { String: 'npm' },
    },
  }
}

const lodash = node(1, 'lodash', '4.17.20')
const express = node(2, 'express', '4.18.2')
const next = node(3, 'next', '14.0.0')
const hono = node(4, 'hono', '4.13.1')

afterEach(() => {
  querySpy?.mockRestore()
})

let querySpy: ReturnType<typeof spyOn> | undefined

describe('POST /seed', () => {
  it('writes the demo nodes and edges', async () => {
    querySpy = spyOn(hydra, 'query');
    const query = querySpy
    query.mockResolvedValue(empty)

    const res = await graph.request('/seed', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, nodes: 4, edges: 3 })
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][0]).toContain('UNWIND $nodes')
    expect(query.mock.calls[1][0]).toContain('UNWIND $edges')
  })
})

describe('GET /blast-radius/:name/:version', () => {
  it('returns transitive dependents from path endpoints', async () => {
    querySpy = spyOn(hydra, 'query');
    const query = querySpy
    query
      .mockResolvedValueOnce(envelope(['id'], idRow(1)))
      .mockResolvedValueOnce(
        envelope(
          ['path'],
          [
            ...pathRow([lodash, express]),
            ...pathRow([lodash, hono]),
            ...pathRow([lodash, express, next]),
          ]
        )
      )

    const res = await graph.request('/blast-radius/lodash/4.17.20')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.package).toEqual({ name: 'lodash', version: '4.17.20' })
    expect(body.count).toBe(3)
    expect(body.dependents.map((d: { name: string }) => d.name).sort()).toEqual([
      'express',
      'hono',
      'next',
    ])
  })

  it('deduplicates dependents that appear in multiple paths', async () => {
    querySpy = spyOn(hydra, 'query');
    const query = querySpy
    query
      .mockResolvedValueOnce(envelope(['id'], idRow(1)))
      .mockResolvedValueOnce(
        envelope(['path'], [...pathRow([lodash, express]), ...pathRow([lodash, express])])
      )

    const res = await graph.request('/blast-radius/lodash/4.17.20')

    expect((await res.json()).count).toBe(1)
  })

  it('returns 404 for an unknown package', async () => {
    querySpy = spyOn(hydra, 'query');
    const query = querySpy
    query.mockResolvedValue(empty)

    const res = await graph.request('/blast-radius/nope/1.0.0')

    expect(res.status).toBe(404)
    expect((await res.json()).count).toBe(0)
  })
})

describe('GET /count/:name/:version', () => {
  it('returns the direct dependents count', async () => {
    querySpy = spyOn(hydra, 'query');
    const query = querySpy
    query
      .mockResolvedValueOnce(envelope(['id'], idRow(1)))
      .mockResolvedValueOnce(envelope(['count'], [[{ type: 'integer', value: 2 }]]))

    const res = await graph.request('/count/lodash/4.17.20')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      package: { name: 'lodash', version: '4.17.20' },
      directDependents: 2,
    })
  })

  it('returns 404 for an unknown package', async () => {
    querySpy = spyOn(hydra, 'query');
    const query = querySpy
    query.mockResolvedValue(empty)

    const res = await graph.request('/count/nope/1.0.0')

    expect(res.status).toBe(404)
    expect((await res.json()).directDependents).toBe(0)
  })
})
