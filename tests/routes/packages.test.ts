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
const int = (value: number) => ({ type: 'integer' as const, value })

describe('GET /api/packages/:name', () => {
  it('returns the package overview', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy
      .mockResolvedValueOnce(envelope(['name', 'ecosystem'], [[str('lodash'), str('npm')]]))
      .mockResolvedValueOnce(envelope(['count'], [[int(2)]]))
      .mockResolvedValueOnce(envelope(['count'], [[int(10)]]))
      .mockResolvedValueOnce(envelope(['version'], [[str('4.17.20')], [str('4.18.1')]]))

    const res = await app.request('/api/packages/lodash')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ name: 'lodash', ecosystem: 'npm', versionCount: 2, advisoryCount: 10 })
    expect(body.versions).toEqual(['4.17.20', '4.18.1'])
  })

  it('returns 404 for an unknown package', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValue(envelope(['name', 'ecosystem'], []))
    const res = await app.request('/api/packages/nope')
    expect(res.status).toBe(404)
  })

  it('rejects invalid package names', async () => {
    const res = await app.request('/api/packages/bad!name')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/packages/:name/:version/blast-radius', () => {
  it('returns blast radius shape', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy
      .mockResolvedValueOnce(envelope(['id'], [[{ type: 'vertex_id', value: 1 }]]))
      .mockResolvedValueOnce(
        envelope(
          ['path'],
          [
            [
              {
                type: 'path',
                value: {
                  nodes: [
                    { id: 1, properties: { name: { String: 'lodash' }, version: { String: '4.17.20' } } },
                    { id: 2, properties: { name: { String: 'express' }, version: { String: '4.18.2' } } },
                  ],
                  relationships: [],
                },
              },
            ],
          ]
        )
      )
      .mockResolvedValue(
        envelope(['repository', 'lockfile', 'commitSha', 'kind', 'requestedVersion', 'resolvedVersion'], [])
      )

    const res = await app.request('/api/packages/lodash/4.17.20/blast-radius')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.package).toEqual({ name: 'lodash', version: '4.17.20', ecosystem: '' })
    expect(body.directDependents).toBe(1)
    expect(body.count).toBe(1)
    expect(body.affectedRepositories).toBe(0)
    expect(body.affectedApplications).toBe(0)
    expect(body.resolutions).toEqual([])
    expect(typeof body.latencyMs).toBe('number')
  })

  it('returns 404 for unknown versions', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValue(envelope(['id'], []))
    const res = await app.request('/api/packages/lodash/9.9.9/blast-radius')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/packages/:name/:version', () => {
  it('returns version details with advisories', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy
      .mockResolvedValueOnce(
        envelope(['name', 'version', 'ecosystem'], [[str('lodash'), str('4.17.20'), str('npm')]])
      )
      .mockResolvedValueOnce(envelope(['id', 'severity', 'summary'], [[str('GHSA-x'), str('HIGH'), str('proto pollution')]]))

    const res = await app.request('/api/packages/lodash/4.17.20')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ name: 'lodash', version: '4.17.20', ecosystem: 'npm' })
    expect(body.advisories).toHaveLength(1)
  })
})
