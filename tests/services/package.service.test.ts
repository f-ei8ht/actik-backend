import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'
import { getPackageOverview, getVersionRelationships, listVersions } from '../../src/services/package.service'
import { AppError } from '../../src/lib/errors'

let querySpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  querySpy?.mockRestore()
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

describe('getPackageOverview', () => {
  it('aggregates package, version and advisory counts', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy
      .mockResolvedValueOnce(envelope(['name', 'ecosystem'], [[str('lodash'), str('npm')]]))
      .mockResolvedValueOnce(envelope(['count'], [[int(2)]]))
      .mockResolvedValueOnce(envelope(['count'], [[int(10)]]))

    const overview = await getPackageOverview('lodash')
    expect(overview).toEqual({ name: 'lodash', ecosystem: 'npm', versions: 2, advisories: 10 })
  })

  it('throws not found for unknown packages', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValueOnce(envelope(['name', 'ecosystem'], []))
    await expect(getPackageOverview('nope')).rejects.toBeInstanceOf(AppError)
  })
})

describe('listVersions', () => {
  it('returns the versions of a package', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockResolvedValueOnce(envelope(['version'], [[str('4.17.20')], [str('4.18.1')]]))

    expect(await listVersions('lodash')).toEqual(['4.17.20', '4.18.1'])
  })
})

describe('getVersionRelationships', () => {
  it('returns forward dependencies and reverse dependents', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy
      .mockResolvedValueOnce(envelope(['name', 'version'], [[str('qs'), str('6.15.3')]]))
      .mockResolvedValueOnce(envelope(['name', 'version'], [[str('express'), str('5.2.1')]]))

    const result = await getVersionRelationships('express', '5.2.1')
    expect(result.dependencies).toEqual([{ name: 'qs', version: '6.15.3', ecosystem: '' }])
    expect(result.dependents).toEqual([{ name: 'express', version: '5.2.1', ecosystem: '' }])
  })
})
