import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import type { QueryResponse } from '../../src/hydra/schema'

let HydraClient: typeof import('../../src/hydra/client').HydraClient
let HydraError: typeof import('../../src/hydra/client').HydraError
let decodePath: typeof import('../../src/hydra/client').decodePath
let decodeValue: typeof import('../../src/hydra/client').decodeValue
let rowsToObjects: typeof import('../../src/hydra/client').rowsToObjects

beforeAll(async () => {
  Bun.env.HYDRADB_HTTP_URL = 'http://127.0.0.1:8443'
  Bun.env.HYDRADB_AUTH_TOKEN = 'test-token-32-characters-long!!'
  Bun.env.HYDRADB_NAMESPACE = 'default'
  Bun.env.HYDRADB_GRAPH_ID = 'default'
  Bun.env.HYDRADB_CELL_ID = 'cell-0'
  const module = await import('../../src/hydra/client')
  HydraClient = module.HydraClient
  HydraError = module.HydraError
  decodePath = module.decodePath
  decodeValue = module.decodeValue
  rowsToObjects = module.rowsToObjects
})

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('decodeValue', () => {
  it('decodes scalar values', () => {
    expect(decodeValue({ type: 'null', value: null })).toBeNull()
    expect(decodeValue({ type: 'string', value: 'lodash' })).toBe('lodash')
    expect(decodeValue({ type: 'boolean', value: true })).toBe(true)
    expect(decodeValue({ type: 'integer', value: 2 })).toBe(2)
    expect(decodeValue({ type: 'signed_integer', value: -5 })).toBe(-5)
    expect(decodeValue({ type: 'float', value: 1.5 })).toBe(1.5)
    expect(decodeValue({ type: 'vertex_id', value: 42 })).toBe(42)
  })

  it('decodes nested lists recursively', () => {
    expect(
      decodeValue({
        type: 'list',
        value: [
          { type: 'string', value: 'a' },
          { type: 'integer', value: 1 },
        ],
      })
    ).toEqual(['a', 1])
  })
})

describe('decodePath', () => {
  it('decodes nodes, labels, and tagged properties', () => {
    const decoded = decodeValue({
      type: 'path',
      value: {
        nodes: [
          {
            id: 1,
            labels: ['PackageVersion'],
            properties: { name: { String: 'lodash' }, version: { String: '4.17.20' } },
          },
          { id: 2, labels: ['PackageVersion'], properties: { name: { String: 'express' } } },
        ],
        relationships: [{ id: 2, edge_type: 'DEPENDS_ON', src: 2, dst: 1, properties: {} }],
      },
    })
    expect(decoded).toEqual({
      nodes: [
        {
          id: 1,
          labels: ['PackageVersion'],
          properties: { name: 'lodash', version: '4.17.20' },
        },
        { id: 2, labels: ['PackageVersion'], properties: { name: 'express' } },
      ],
      relationships: [{ id: 2, edge_type: 'DEPENDS_ON', src: 2, dst: 1, properties: {} }],
    })
  })

  it('decodes integer and boolean properties', () => {
    const path = decodePath({
      nodes: [
        {
          id: 7,
          labels: ['Package'],
          properties: { score: { Integer: 10 }, active: { Bool: true } },
        },
      ],
      relationships: [],
    })
    expect(path?.nodes[0].properties).toEqual({ score: 10, active: true })
  })

  it('returns null for non-path input', () => {
    expect(decodePath('nope')).toBeNull()
    expect(decodePath({})).toBeNull()
    expect(decodePath(null)).toBeNull()
  })
})

describe('rowsToObjects', () => {
  it('maps columns to decoded row objects', () => {
    const response: QueryResponse = {
      query_id: 'q1',
      columns: ['id', 'name'],
      rows: [
        [
          { type: 'vertex_id', value: 2 },
          { type: 'string', value: 'express' },
        ],
      ],
      read_epoch: 1,
      next_cursor: null,
      bookmark: null,
    }
    expect(rowsToObjects(response)).toEqual([{ id: 2, name: 'express' }])
  })
})

describe('HydraClient.query', () => {
  it('posts the query and parses the response envelope', async () => {
    const responseBody = {
      query_id: 'http-query-1',
      columns: ['id'],
      rows: [[{ type: 'vertex_id', value: 2 }]],
      read_epoch: 1,
      next_cursor: null,
      bookmark: 'sgk:1',
    }
    globalThis.fetch = (mock(async (url: unknown, init: RequestInit) => {
      expect(String(url)).toBe('http://127.0.0.1:8443/v1/graphs/default/query')
      expect(init.method).toBe('POST')
      const headers = init.headers as Record<string, string>
      expect(headers['x-graph-namespace']).toBe('default')
      expect(headers.Authorization).toBe('Bearer test-token-32-characters-long!!')
      expect(JSON.parse(String(init.body))).toMatchObject({
        cell_id: 'cell-0',
        query: 'MATCH (n) RETURN n.id',
      })
      return jsonResponse(responseBody)
    }) as unknown as typeof fetch)

    const client = new HydraClient()
    const result = await client.query('MATCH (n) RETURN n.id')
    expect(result.rows[0][0]).toEqual({ type: 'vertex_id', value: 2 })
    expect(result.bookmark).toBe('sgk:1')
  })

  it('sends optional parameters and consistency', async () => {
    globalThis.fetch = (mock(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body.parameters).toEqual({ name: 'lodash' })
      expect(body.consistency).toBe('causal')
      expect(body.timeout_ms).toBe(5000)
      return jsonResponse({
        query_id: 'q',
        columns: [],
        rows: [],
        read_epoch: null,
        next_cursor: null,
        bookmark: null,
      })
    }) as unknown as typeof fetch)

    const client = new HydraClient()
    await client.query('MATCH (n {name: $name}) RETURN n', {
      parameters: { name: 'lodash' },
      consistency: 'causal',
      timeoutMs: 5000,
    })
  })

  it('parses the error envelope into a HydraError', async () => {
    globalThis.fetch = (mock(async () =>
      jsonResponse({ error: { code: 'invalid_request', message: 'bad query' } }, 400)
    ) as unknown as typeof fetch)
    const client = new HydraClient()
    const error = (await client.query('BAD').catch((err) => err)) as InstanceType<typeof HydraError>
    expect(error).toBeInstanceOf(HydraError)
    expect(error.status).toBe(400)
    expect(error.code).toBe('invalid_request')
    expect(error.message).toBe('bad query')
  })

  it('keeps the raw body for non-JSON errors', async () => {
    globalThis.fetch = (mock(async () => new Response('upstream exploded', { status: 502 })) as unknown as typeof fetch)
    const client = new HydraClient()
    const error = (await client.query('MATCH (n) RETURN n').catch((err) => err)) as InstanceType<typeof HydraError>
    expect(error).toBeInstanceOf(HydraError)
    expect(error.status).toBe(502)
    expect(error.code).toBe('http_error')
    expect(error.message).toBe('upstream exploded')
  })

  it('throws invalid_response on an unexpected success body', async () => {
    globalThis.fetch = (mock(async () => jsonResponse({ unexpected: true })) as unknown as typeof fetch)
    const client = new HydraClient()
    const error = (await client.query('MATCH (n) RETURN n').catch((err) => err)) as InstanceType<typeof HydraError>
    expect(error).toBeInstanceOf(HydraError)
    expect(error.code).toBe('invalid_response')
  })
})
