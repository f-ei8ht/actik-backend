import { hydra, rowsToObjects } from '../hydra/client'
import { log } from '../lib/logger'
import { runIngestion } from './runner'

const GRAPH_CHECK = `
MATCH (v:PackageVersion)
RETURN count(*) AS count
`

/**
 * true when the graph already has version nodes, false when empty,
 * null when HydraDB is unreachable.
 */
async function isGraphSeeded(): Promise<boolean | null> {
  try {
    const rows = rowsToObjects(await hydra.query(GRAPH_CHECK, { consistency: 'causal' }))
    return Number(rows[0]?.count ?? 0) > 0
  } catch {
    return null
  }
}

/**
 * Auto-seed on boot: if HydraDB has no package graph yet, run the full
 * ingestion pipeline so the API is usable without any manual step. Skips
 * immediately when the graph is already seeded (fast restarts), and never
 * blocks the server when HydraDB is unreachable.
 */
export async function ensureSeeded(): Promise<void> {
  try {
    const seeded = await isGraphSeeded()
    if (seeded === null) {
      log.warn('hydradb not reachable at startup; skipping auto-seed')
      return
    }
    if (seeded) {
      log.info('graph already seeded; skipping ingestion')
      return
    }
    const startedAt = Date.now()
    log.info('graph is empty; running automatic ingestion...')
    await runIngestion()
    log.info(`automatic ingestion finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
  } catch (error) {
    log.error('auto-seed failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
