import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { fetchOsvFindings } from '../../src/analysis/osv-findings'
import type { ResolvedDepRef } from '../../src/analysis/exposure'

let fetchSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  fetchSpy?.mockRestore()
})

const lodashDoc = {
  id: 'GHSA-xvch-5gv4-984h',
  summary: 'Prototype pollution in lodash',
  details: 'detail',
  published: '2021-05-06T16:05:51Z',
  modified: '2025-09-29T21:12:31Z',
  severity: [{ type: 'CVSS_V3', score: '7.5' }],
  affected: [
    {
      package: { ecosystem: 'npm', name: 'lodash' },
      ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
    },
  ],
}

function mockFetch(vulnsPerQuery: Array<Array<{ id: string }>>, docs: Record<string, unknown>) {
  fetchSpy = spyOn(globalThis, 'fetch')
  fetchSpy.mockImplementation((input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/v1/querybatch')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: vulnsPerQuery.map((vulns) => ({ vulns })) }),
      } as Response)
    }
    const match = url.match(/\/v1\/vulns\/(.+)$/)
    const id = match ? decodeURIComponent(match[1]) : ''
    const doc = docs[id]
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(doc ?? null),
    } as Response)
  })
}

const dep: ResolvedDepRef = {
  ecosystem: 'npm',
  name: 'lodash',
  requestedVersion: '^4.17.0',
  resolvedVersion: '4.17.20',
  lockfilePath: 'package-lock.json',
}

describe('fetchOsvFindings', () => {
  it('returns findings for versions OSV reports as affected', async () => {
    mockFetch([[{ id: 'GHSA-xvch-5gv4-984h' }]], {
      'GHSA-xvch-5gv4-984h': lodashDoc,
    })

    const findings = await fetchOsvFindings([dep], 'acme/app')

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding.package).toBe('lodash')
    expect(finding.severity).toBe('HIGH')
    expect(finding.source).toBe('osv')
    expect(finding.fix).toBe('npm install lodash@4.17.21')
    expect(finding.advisory.id).toBe('GHSA-xvch-5gv4-984h')
    expect(finding.paths[0]).toEqual(['acme/app', 'package-lock.json', 'lodash@4.17.20'])
  })

  it('skips advisories already found by the graph', async () => {
    mockFetch([[{ id: 'GHSA-xvch-5gv4-984h' }]], {
      'GHSA-xvch-5gv4-984h': lodashDoc,
    })

    const findings = await fetchOsvFindings(
      [dep],
      'acme/app',
      new Set(['GHSA-xvch-5gv4-984h:lodash@4.17.20'])
    )

    expect(findings).toHaveLength(0)
  })

  it('skips withdrawn advisories', async () => {
    mockFetch([[{ id: 'GHSA-withdrawn' }]], {
      'GHSA-withdrawn': { ...lodashDoc, id: 'GHSA-withdrawn', withdrawn: '2022-01-01T00:00:00Z' },
    })

    const findings = await fetchOsvFindings([dep], 'acme/app')

    expect(findings).toHaveLength(0)
  })
})
