import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { app } from '../../src/index'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'

let querySpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  querySpy?.mockRestore()
  mock.restore()
})

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

const str = (value: string) => ({ type: 'string' as const, value })

describe('POST /api/graph/seed', () => {
  it('writes the demo nodes and edges', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValue(envelope([], []))

    const res = await app.request('/api/graph/seed', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, nodes: 4, edges: 3 })
    expect(querySpy).toHaveBeenCalledTimes(2)
    expect(querySpy.mock.calls[0][0]).toContain('UNWIND $nodes')
    expect(querySpy.mock.calls[1][0]).toContain('UNWIND $edges')
  })
})

describe('GET /api/graph/:name/:version', () => {
  it('returns the dependency neighborhood graph', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy
      .mockResolvedValueOnce(envelope(['name', 'version', 'ecosystem'], [[str('lodash'), str('4.17.20'), str('npm')]]))
      .mockResolvedValueOnce(envelope(['name', 'version', 'ecosystem'], [[str('qs'), str('6.15.3'), str('npm')]]))
      .mockResolvedValueOnce(envelope(['name', 'version', 'ecosystem'], [[str('express'), str('5.2.1'), str('npm')]]))
      .mockResolvedValueOnce(envelope(['id', 'severity', 'summary'], [[str('GHSA-x'), str('HIGH'), str('proto pollution')]]))

    const res = await app.request('/api/graph/lodash/4.17.20')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.root).toBe('lodash@4.17.20')
    expect(body.nodes.map((n: { label: string }) => n.label)).toContain('express')
    expect(body.edges.some((e: { type: string }) => e.type === 'affected_by')).toBe(true)
  })

  it('returns 404 for unknown versions', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValue(envelope(['name', 'version', 'ecosystem'], []))
    const res = await app.request('/api/graph/lodash/9.9.9')
    expect(res.status).toBe(404)
  })
})
