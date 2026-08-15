import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'
import { analyzeExposure, computeMinimalFixSet, type ResolvedDepRef } from '../../src/analysis/exposure'
import { packageVersionId } from '../../src/ingestion/types'

let querySpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  querySpy?.mockRestore()
})

const str = (value: string) => ({ type: 'string' as const, value })
const num = (value: number) => ({ type: 'integer' as const, value })
const nil = () => ({ type: 'null' as const, value: null })

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

const dep: ResolvedDepRef = {
  ecosystem: 'npm',
  name: 'lodash',
  requestedVersion: '^4.17.0',
  resolvedVersion: '4.17.20',
  lockfilePath: 'package-lock.json',
}

describe('analyzeExposure', () => {
  it('returns no findings for a clean dependency set', async () => {
    querySpy = spyOn(hydra, 'query')
    const versionId = packageVersionId('npm', 'lodash', '4.17.20')
    querySpy.mockResolvedValue(
      response(
        ['versionId', 'name', 'version', 'ecosystem', 'advisoryId', 'severity', 'summary', 'publishedAt', 'modifiedAt', 'fixedVersions'],
        [[num(versionId), str('lodash'), str('4.17.20'), str('npm'), nil(), str(''), str(''), str(''), str(''), str('')]]
      )
    )

    const result = await analyzeExposure([dep], 'acme/payments')

    expect(result.findings).toHaveLength(0)
    expect(result.score.total).toBe(0)
    expect(result.score.severity).toBe('CLEAN')
    expect(result.vulnerable).toBe(0)
    expect(result.clean).toBe(1)
    expect(result.unlinked).toHaveLength(0)
  })

  it('flags vulnerable versions with fixes and exposure paths', async () => {
    querySpy = spyOn(hydra, 'query')
    const lodashId = packageVersionId('npm', 'lodash', '4.17.20')
    const expressId = packageVersionId('npm', 'express', '4.18.2')
    const deps: ResolvedDepRef[] = [
      dep,
      { ecosystem: 'npm', name: 'express', requestedVersion: '^4.18.0', resolvedVersion: '4.18.2', lockfilePath: 'package-lock.json' },
    ]
    querySpy.mockImplementation((query: string, options?: { parameters?: Record<string, unknown> }) => {
      if (query.includes('OPTIONAL MATCH (v)-[:AFFECTED_BY]')) {
        const id = Number(options?.parameters?.id)
        if (id === lodashId) {
          return Promise.resolve(
            response(
              ['versionId', 'name', 'version', 'ecosystem', 'advisoryId', 'severity', 'summary', 'publishedAt', 'modifiedAt', 'fixedVersions'],
              [[
                num(lodashId),
                str('lodash'),
                str('4.17.20'),
                str('npm'),
                str('GHSA-prototype-pollution'),
                str('HIGH'),
                str('Prototype pollution'),
                str('2021-01-01T00:00:00Z'),
                str('2021-05-01T00:00:00Z'),
                str(JSON.stringify({ lodash: '4.17.21' })),
              ]]
            )
          )
        }
        return Promise.resolve(
          response(
            ['versionId', 'name', 'version', 'ecosystem', 'advisoryId', 'severity', 'summary', 'publishedAt', 'modifiedAt', 'fixedVersions'],
            [[num(expressId), str('express'), str('4.18.2'), str('npm'), nil(), str(''), str(''), str(''), str(''), str('')]]
          )
        )
      }
      if (query.includes('algo.SSpaths')) {
        return Promise.resolve(
          pathResponse([
            [node(expressId, 'express', '4.18.2'), node(lodashId, 'lodash', '4.17.20')],
          ])
        )
      }
      return Promise.resolve(response([], []))
    })

    const result = await analyzeExposure(deps, 'acme/payments')

    expect(result.findings).toHaveLength(1)
    const finding = result.findings[0]
    expect(finding.package).toBe('lodash')
    expect(finding.severity).toBe('HIGH')
    expect(finding.fix).toBe('npm install lodash@4.17.21')
    expect(finding.paths[0]).toEqual(['acme/payments', 'package-lock.json', 'express@4.18.2', 'lodash@4.17.20'])
    expect(finding.depth).toBe(1)
    expect(result.score.total).toBe(56)
    expect(result.score.severity).toBe('HIGH')
    expect(result.score.breakdown).toEqual({ HIGH: 1 })
    expect(result.vulnerable).toBe(1)
    expect(result.clean).toBe(1)
  })

  it('reports unlinked versions that are not present in the graph', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValue(response([], []))

    const result = await analyzeExposure([dep], 'acme/payments')

    expect(result.unlinked).toEqual([
      { ecosystem: 'npm', name: 'lodash', version: '4.17.20' },
    ])
    expect(result.linked).toBe(0)
  })

  it('caps the score at 100 for many findings', async () => {
    querySpy = spyOn(hydra, 'query')
    const deps: ResolvedDepRef[] = []
    const rowsByVersion = new Map<number, QueryResponse['rows'][number]>()
    for (let i = 0; i < 5; i++) {
      const name = `pkg-${i}`
      const version = '1.0.0'
      const versionId = packageVersionId('npm', name, version)
      deps.push({ ecosystem: 'npm', name, resolvedVersion: version, lockfilePath: 'package-lock.json' })
      rowsByVersion.set(versionId, [
        num(versionId), str(name), str(version), str('npm'), str(`adv-${i}`), str('CRITICAL'),
        str('x'), str('2021-01-01T00:00:00Z'), str('2021-05-01T00:00:00Z'), str(''),
      ])
    }
    querySpy.mockImplementation((query: string, options?: { parameters?: Record<string, unknown> }) => {
      if (query.includes('algo.SSpaths')) return Promise.resolve(response([], []))
      const row = rowsByVersion.get(Number(options?.parameters?.id))
      return Promise.resolve(
        response(
          ['versionId', 'name', 'version', 'ecosystem', 'advisoryId', 'severity', 'summary', 'publishedAt', 'modifiedAt', 'fixedVersions'],
          row ? [row] : []
        )
      )
    })

    const result = await analyzeExposure(deps, 'acme/payments')
    expect(result.score.total).toBe(100)
    expect(result.score.severity).toBe('CRITICAL')
    expect(result.score.breakdown).toEqual({ CRITICAL: 5 })
  })
})

describe('computeMinimalFixSet', () => {
  function finding(overrides: Partial<import('../../src/analysis/exposure').ScanFinding>): import('../../src/analysis/exposure').ScanFinding {
    return {
      package: 'lodash',
      ecosystem: 'npm',
      resolvedVersion: '4.17.20',
      severity: 'HIGH',
      advisory: { id: 'GHSA-a', summary: 'x', publishedAt: '', modifiedAt: '', references: '' },
      fix: null,
      fixedVersion: '4.17.21',
      source: 'graph',
      paths: [['acme/app', 'package-lock.json', 'lodash@4.17.20']],
      depth: 0,
      ...overrides,
    }
  }

  it('groups findings by package and verifies each upgrade against the graph', async () => {
    querySpy = spyOn(hydra, 'query')
    const lodashId = packageVersionId('npm', 'lodash', '4.17.21')
    const qsId = packageVersionId('npm', 'qs', '6.7.3')
    querySpy.mockImplementation((query: string) => {
      if (query.includes('count(*)')) {
        return Promise.resolve(
          response(['id', 'count'], [
            [{ type: 'vertex_id', value: lodashId }, num(0)],
            [{ type: 'vertex_id', value: qsId }, num(0)],
          ])
        )
      }
      if (query.includes('RETURN v.id AS id')) {
        return Promise.resolve(
          response(['id'], [
            [{ type: 'vertex_id', value: lodashId }],
            [{ type: 'vertex_id', value: qsId }],
          ])
        )
      }
      return Promise.resolve(response([], []))
    })

    const findings = [
      finding({ package: 'lodash', fixedVersion: '4.17.21' }),
      finding({ package: 'lodash', advisory: { id: 'GHSA-b', summary: 'y', publishedAt: '', modifiedAt: '', references: '' } }),
      finding({ package: 'qs', resolvedVersion: '6.5.2', fixedVersion: '6.7.3' }),
    ]

    const result = await computeMinimalFixSet(findings)

    expect(result.upgrades).toHaveLength(2)
    expect(result.upgrades[0]).toMatchObject({
      package: 'lodash',
      from: '4.17.20',
      to: '4.17.21',
      findingCount: 2,
      verified: true,
    })
    expect(result.upgrades[0].command).toBe('npm install lodash@4.17.21')
    expect(result.verified).toBe(2)
    expect(result.total).toBe(2)
    expect(result.commands).toEqual([
      'npm install lodash@4.17.21',
      'npm install qs@6.7.3',
    ])
  })

  it('marks an upgrade unverified when the target version has advisories', async () => {
    querySpy = spyOn(hydra, 'query')
    const lodashId = packageVersionId('npm', 'lodash', '4.17.21')
    querySpy.mockImplementation((query: string) => {
      if (query.includes('RETURN v.id AS id')) {
        return Promise.resolve(response(['id'], [[{ type: 'vertex_id', value: lodashId }]]))
      }
      if (query.includes('count(*)')) {
        return Promise.resolve(
          response(['id', 'count'], [[{ type: 'vertex_id', value: lodashId }, num(2)]])
        )
      }
      return Promise.resolve(response([], []))
    })

    const result = await computeMinimalFixSet([finding({})])

    expect(result.upgrades[0].verified).toBe(false)
    expect(result.verified).toBe(0)
  })

  it('returns an empty set when nothing is fixable', async () => {
    const result = await computeMinimalFixSet([])
    expect(result.upgrades).toEqual([])
    expect(result.commands).toEqual([])
  })
})
