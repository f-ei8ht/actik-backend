import { describe, expect, it } from 'bun:test'
import { GraphWriter, WRITE_BATCH_SIZE } from '../../src/ingestion/graph-writer'
import { edgeId, packageVersionId, type ResolvesEdge } from '../../src/ingestion/types'
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

  it('writes organization, repository and lockfile node batches', async () => {
    const client = new FakeClient()
    const writer = new GraphWriter(client as never)

    writer.addOrganizations([{ id: 1, name: 'Acme' }])
    writer.addRepositories([{ id: 2, name: 'payments-api', org: 'Acme', language: 'typescript', kind: 'application' }])
    writer.addLockfiles([
      { id: 3, path: 'payments-api/package-lock.json', ecosystem: 'npm', repository: 'payments-api', commitSha: 'abc', kind: 'application' },
    ])

    await writer.flush()

    const queries = client.calls.map((call) => call.query)
    expect(queries.some((q) => q.includes('SET v:Organization'))).toBe(true)
    expect(queries.some((q) => q.includes('SET v:Repository'))).toBe(true)
    expect(queries.some((q) => q.includes('SET v:Lockfile'))).toBe(true)
  })

  it('writes RESOLVES edges with resolution evidence properties', async () => {
    const client = new FakeClient()
    const writer = new GraphWriter(client as never)

    const resolves: ResolvesEdge[] = [
      {
        id: edgeId('RESOLVES', 3, 4),
        source: 3,
        target: 4,
        requestedVersion: '^4.17.0',
        resolvedVersion: '4.17.20',
        lockfilePath: 'payments-api/package-lock.json',
        repository: 'payments-api',
        commitSha: 'abc',
      },
    ]
    writer.addEdges('RESOLVES', resolves)

    await writer.flush()

    const call = client.calls.find((entry) => entry.query.includes('MERGE (s)-[r:RESOLVES'))
    expect(call).toBeDefined()
    expect(call?.query).toContain('r.resolved_version = e.resolvedVersion')
    const edges = call?.parameters.edges as Array<Record<string, string>>
    expect(edges[0].requestedVersion).toBe('^4.17.0')
    expect(edges[0].resolvedVersion).toBe('4.17.20')
  })

  it('returns a write summary', async () => {
    const client = new FakeClient()
    const writer = new GraphWriter(client as never)
    writer.addPackages([{ id: 1, name: 'a', ecosystem: 'npm' }])
    writer.addVersions([{ id: 2, packageId: 1, name: 'a', version: '1.0.0', ecosystem: 'npm' }])
    writer.addOrganizations([{ id: 10, name: 'Acme' }])
    writer.addRepositories([{ id: 11, name: 'r', org: 'Acme', language: 'typescript', kind: 'application' }])
    writer.addLockfiles([{ id: 12, path: 'r/package-lock.json', ecosystem: 'npm', repository: 'r', commitSha: 'x', kind: 'application' }])
    writer.addEdges('DEPENDS_ON', [{ id: 3, source: 2, target: 4 }])

    const summary = await writer.flush()
    expect(summary).toEqual({
      packages: 1,
      versions: 1,
      maintainers: 0,
      advisories: 0,
      organizations: 1,
      repositories: 1,
      lockfiles: 1,
      edges: { DEPENDS_ON: 1 },
    })
  })
})
