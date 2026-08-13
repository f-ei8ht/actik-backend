import { describe, expect, it } from 'bun:test'
import { mergeAdvisories } from '../../src/ingestion/advisory'
import { advisoryNodeId } from '../../src/ingestion/types'
import type { AdvisoryRecord } from '../../src/ingestion/advisory/types'

function record(advisoryId: string, affected: AdvisoryRecord['affected']): AdvisoryRecord {
  return {
    node: {
      id: advisoryNodeId(advisoryId),
      advisoryId,
      severity: 'HIGH',
      summary: advisoryId,
      publishedAt: '',
      references: '',
    },
    affected,
  }
}

describe('mergeAdvisories', () => {
  it('deduplicates records with the same advisory id', () => {
    const merged = mergeAdvisories([
      record('PYSEC-2022-2', [{ ecosystem: 'PyPI', name: 'Django', versions: ['3.2.5'] }]),
      record('PYSEC-2022-2', [{ ecosystem: 'PyPI', name: 'Django', versions: ['3.2.5'] }]),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].affected[0].versions).toEqual(['3.2.5'])
  })

  it('unions affected versions across duplicate sources', () => {
    const merged = mergeAdvisories([
      record('GHSA-xxxx', [{ ecosystem: 'npm', name: 'lodash', versions: ['4.17.20'] }]),
      record('GHSA-xxxx', [{ ecosystem: 'npm', name: 'lodash', versions: ['4.17.21'] }]),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].affected[0].versions.sort()).toEqual(['4.17.20', '4.17.21'])
  })

  it('combines different advisories', () => {
    const merged = mergeAdvisories([
      record('GHSA-a', [{ ecosystem: 'npm', name: 'lodash', versions: ['4.17.20'] }]),
      record('PYSEC-b', [{ ecosystem: 'PyPI', name: 'requests', versions: ['2.26.0'] }]),
    ])
    expect(merged).toHaveLength(2)
  })
})
