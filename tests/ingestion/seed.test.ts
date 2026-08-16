import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import * as runner from '../../src/ingestion/runner'
import { ensureSeeded } from '../../src/ingestion/seed'
import { hydra } from '../../src/hydra/client'
import type { QueryResponse } from '../../src/hydra/schema'

let querySpy: ReturnType<typeof spyOn> | undefined
let ingestSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  querySpy?.mockRestore()
  ingestSpy?.mockRestore()
})

function countResponse(count: number): QueryResponse {
  return {
    query_id: 'q',
    columns: ['count'],
    rows: [[{ type: 'integer', value: count }]],
    read_epoch: 1,
    next_cursor: null,
    bookmark: null,
  }
}

describe('ensureSeeded', () => {
  it('runs ingestion when the graph is empty', async () => {
    querySpy = spyOn(hydra, 'query').mockResolvedValue(countResponse(0))
    ingestSpy = spyOn(runner, 'runIngestion').mockResolvedValue(undefined)

    await ensureSeeded()

    expect(ingestSpy).toHaveBeenCalled()
  })

  it('skips ingestion when the graph already has versions', async () => {
    querySpy = spyOn(hydra, 'query').mockResolvedValue(countResponse(42))
    ingestSpy = spyOn(runner, 'runIngestion').mockResolvedValue(undefined)

    await ensureSeeded()

    expect(ingestSpy).not.toHaveBeenCalled()
  })

  it('does not block or ingest when HydraDB is unreachable', async () => {
    querySpy = spyOn(hydra, 'query').mockRejectedValue(new Error('connection refused'))
    ingestSpy = spyOn(runner, 'runIngestion').mockResolvedValue(undefined)

    await ensureSeeded()

    expect(ingestSpy).not.toHaveBeenCalled()
  })
})
