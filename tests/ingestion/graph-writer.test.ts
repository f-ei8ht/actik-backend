import { describe, expect, it } from 'bun:test'
import { GraphWriter, WRITE_BATCH_SIZE } from '../../src/ingestion/graph-writer'
import { edgeId, packageVersionId } from '../../src/ingestion/types'
import type { QueryResponse } from '../../src/hydra/schema'

class FakeClient {
  calls: Array<{ query: string; parameters: Record<string, unknown> }> = []

  async query(query: string, options: { parameters: Record<string, unknown> }): Promise<QueryResponse> {
    this.calls.push({ query, parameters: options.parameters })
    return {
      query_id: 'q',
      columns: [],
      rows: [],
      read_epoch: null,
      next_cursor: null,
      bookmark: null,
    }
  }
}

describe('GraphWriter', () => {
  it('writes node batches with UNWIND queries', async () => {
    const client = new FakeClient()
    const writer = new GraphWriter(client as never)

    writer.addPackages([{ id: 1, name: 'lodash', ecosystem: 'npm' }])
    writer.addVersions([
      { id: packageVersionId('npm', 'lodash', '4.17.21'), packageId: 1, name: 'lodash', version: '4.17.21', ecosystem: 'npm' },
    ])
    writer.addMaintainers([{ id: 9, name: 'jdalton', ecosystem: 'npm' }])

    await writer.flush()

    const queries = client.calls.map((call) => call.query)
    expect(queries.some((q) => q.includes('UNWIND $nodes') && q.includes('SET v:Package'))).toBe(true)
    expect(queries.some((q) => q.includes('SET v:PackageVersion'))).toBe(true)
    expect(queries.some((q) => q.includes('SET v:Maintainer'))).toBe(true)
  })

  it('writes edge batches with a literal relationship type', async () => {
    const client = new FakeClient()
    const writer = new GraphWriter(client as never)

    writer.addEdges('DEPENDS_ON', [
      { id: edgeId('DEPENDS_ON', 1, 2), source: 1, target: 2 },
    ])
    writer.addEdges('AFFECTED_BY', [
      { id: edgeId('AFFECTED_BY', 2, 3), source: 2, target: 3 },
    ])

    await writer.flush()

    expect(client.calls.some((call) => call.query.includes('MERGE (s)-[r:DEPENDS_ON')))
    expect(client.calls.some((call) => call.query.includes('MERGE (s)-[r:AFFECTED_BY')))
  })

  it('chunks large batches', async () => {
    const client = new FakeClient()
    const writer = new GraphWriter(client as never)
    const edges = Array.from({ length: WRITE_BATCH_SIZE * 2 + 10 }, (_, i) => ({
      id: i,
      source: i,
      target: i + 1,
    }))

    writer.addEdges('DEPENDS_ON', edges)
    await writer.flush()

    const edgeCalls = client.calls.filter((call) => call.query.includes('DEPENDS_ON'))
    expect(edgeCalls.length).toBe(3)
    expect((edgeCalls[0].parameters.edges as unknown[]).length).toBe(WRITE_BATCH_SIZE)
    expect((edgeCalls[2].parameters.edges as unknown[]).length).toBe(10)
  })

  it('returns a write summary', async () => {
    const client = new FakeClient()
    const writer = new GraphWriter(client as never)
    writer.addPackages([{ id: 1, name: 'a', ecosystem: 'npm' }])
    writer.addVersions([{ id: 2, packageId: 1, name: 'a', version: '1.0.0', ecosystem: 'npm' }])
    writer.addEdges('DEPENDS_ON', [{ id: 3, source: 2, target: 4 }])

    const summary = await writer.flush()
    expect(summary).toEqual({
      packages: 1,
      versions: 1,
      maintainers: 0,
      advisories: 0,
      edges: { DEPENDS_ON: 1 },
    })
  })
})
