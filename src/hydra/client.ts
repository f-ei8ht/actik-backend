import { env } from '../lib/config'
import {
  errorEnvelopeSchema,
  queryResponseSchema,
  type HydraValue,
  type QueryResponse,
} from './schema'

export interface QueryOptions {
  parameters?: Record<string, unknown>
  consistency?: 'causal' | 'strong'
  timeoutMs?: number
  bookmark?: string
}

export class HydraError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HydraError'
  }
}

export class HydraClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly namespace: string
  private readonly graphId: string
  private readonly cellId: string

  constructor() {
    this.baseUrl = env.HYDRADB_HTTP_URL.replace(/\/+$/, '')
    this.token = env.HYDRADB_AUTH_TOKEN
    this.namespace = env.HYDRADB_NAMESPACE
    this.graphId = env.HYDRADB_GRAPH_ID
    this.cellId = env.HYDRADB_CELL_ID
  }

  async query(cypher: string, options: QueryOptions = {}): Promise<QueryResponse> {
    const response = await fetch(`${this.baseUrl}/v1/graphs/${this.graphId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'x-graph-namespace': this.namespace,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cell_id: this.cellId,
        query: cypher,
        ...(options.parameters ? { parameters: options.parameters } : {}),
        ...(options.consistency ? { consistency: options.consistency } : {}),
        ...(options.timeoutMs ? { timeout_ms: options.timeoutMs } : {}),
        ...(options.bookmark ? { bookmark: options.bookmark } : {}),
      }),
    })

    if (!response.ok) {
      throw await this.parseError(response)
    }

    const parsed = queryResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new HydraError(502, 'invalid_response', 'HydraDB returned an unexpected response')
    }
    return parsed.data
  }

  private async parseError(response: Response): Promise<HydraError> {
    const text = await response.text()
    let code = 'http_error'
    let message = text || response.statusText
    try {
      const envelope = errorEnvelopeSchema.parse(JSON.parse(text))
      code = envelope.error.code
      message = envelope.error.message
    } catch {
      // Non-JSON error body; keep the raw text.
    }
    return new HydraError(response.status, code, message)
  }
}

export interface PathNode {
  id: number
  labels: string[]
  properties: Record<string, unknown>
}

export interface Path {
  nodes: PathNode[]
  relationships: unknown[]
}

function decodeProperty(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  if ('String' in record) return record.String
  if ('Integer' in record) return record.Integer
  if ('SignedInteger' in record) return record.SignedInteger
  if ('Float' in record) return record.Float
  if ('Bool' in record) return record.Bool
  return value
}

function decodeProperties(properties: Record<string, unknown> | undefined): Record<string, unknown> {
  const decoded: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties ?? {})) {
    decoded[key] = decodeProperty(value)
  }
  return decoded
}

export function decodePath(value: unknown): Path | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as { nodes?: unknown[]; relationships?: unknown[] }
  if (!Array.isArray(raw.nodes)) return null
  return {
    nodes: raw.nodes.map((entry) => {
      const node = entry as { id?: number; labels?: string[]; properties?: Record<string, unknown> }
      return {
        id: Number(node.id),
        labels: Array.isArray(node.labels) ? node.labels : [],
        properties: decodeProperties(node.properties),
      }
    }),
    relationships: Array.isArray(raw.relationships) ? raw.relationships : [],
  }
}

export function decodeValue(value: HydraValue): unknown {
  switch (value.type) {
    case 'null':
      return null
    case 'string':
    case 'boolean':
    case 'float':
    case 'integer':
    case 'signed_integer':
    case 'vertex_id':
      return value.value
    case 'list':
      return value.value.map(decodeValue)
    case 'path':
      return decodePath(value.value)
  }
}

export function rowsToObjects(response: QueryResponse): Record<string, unknown>[] {
  return response.rows.map((row) => {
    const object: Record<string, unknown> = {}
    response.columns.forEach((column, index) => {
      object[column] = decodeValue(row[index])
    })
    return object
  })
}

export const hydra = new HydraClient()
