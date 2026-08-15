import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'
import { getMaintainerRisk } from '../../src/services/maintainer.service'

let querySpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  querySpy?.mockRestore()
})

const str = (value: string) => ({ type: 'string' as const, value })

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

describe('getMaintainerRisk', () => {
  it('traces compromised maintainers to packages present in repositories', async () => {
    querySpy = spyOn(hydra, 'query')
    querySpy.mockImplementation((query: string, options?: { parameters?: Record<string, unknown> }) => {
      if (query.includes('RETURN m.name AS name')) {
        return Promise.resolve(response(['name'], [[str('alice')]]))
      }
      if (query.includes('RETURN q.name AS name')) {
        return Promise.resolve(
          response(['name', 'maintainer'], [
            [str('pkg-a'), str('alice')],
            [str('pkg-b'), str('alice')],
          ])
        )
      }
      if (query.includes('RETURN DISTINCT l.repository AS repository')) {
        const packageName = String(options?.parameters?.name)
        return Promise.resolve(
          response(
            ['repository', 'version'],
            packageName === 'pkg-a'
              ? [[str('payments-api'), str('1.0.0')]]
              : []
          )
        )
      }
      return Promise.resolve(response([], []))
    })

    const risk = await getMaintainerRisk('evil-pkg', 'npm')

    expect(risk.maintainers).toEqual(['alice'])
    expect(risk.totalPackages).toBe(2)
    expect(risk.presentInRepositories).toBe(1)
    const pkgA = risk.controlledPackages.find((entry) => entry.package === 'pkg-a')
    expect(pkgA?.repositories).toEqual(['payments-api'])
    expect(pkgA?.versions).toEqual(['1.0.0'])
    const pkgB = risk.controlledPackages.find((entry) => entry.package === 'pkg-b')
    expect(pkgB?.repositories).toEqual([])
  })
})
