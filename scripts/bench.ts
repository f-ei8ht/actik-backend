/**
 * actik benchmark + evaluation harness.
 *
 * Reports real numbers straight from HydraDB (never invented):
 *
 *   1. Dataset report      - packages, versions, edges, advisories, repos, lockfiles
 *   2. Query latency       - P50 / P95 / P99 (+ mean) for real package, dependency,
 *                            advisory and blast-radius queries, repeated N times
 *   3. Precision / recall  - blast-radius findings vs OSV ground truth at the
 *                            (application, resolved-version, advisory) level
 *
 * Usage (requires a running HydraDB + seeded graph):
 *
 *   bun run bench            # dataset + latency only
 *   bun run bench:all        # dataset + latency + precision/recall (hits OSV)
 *   bun run bench --help
 */

import { hydra, rowsToObjects } from '../src/hydra/client'
import {
  blastRadiusQuery,
  versionDetailsQuery,
  dependenciesQuery,
  dependentsQuery,
  advisoriesForVersionQuery,
} from '../src/hydra/queries'
import { computeBlastRadius } from '../src/analysis/blast-radius'
import { loadDemoOrg, readLockfile } from '../src/ingestion/lockfile/demo-org'
import { parseLockfile } from '../src/ingestion/lockfile'
import { testOsvAffected, type OsvVulnDoc } from '../src/ingestion/version'
import { env } from '../src/lib/config'

// ---------------------------------------------------------------------------
// stats helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(label: string, samples: number[]): void {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, value) => acc + value, 0)
  const mean = sorted.length ? sum / sorted.length : 0
  const round = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : 'n/a')
  console.log(
    `  ${label.padEnd(22)} n=${String(sorted.length).padStart(4)}  ` +
      `min=${round(sorted[0]).padStart(7)}  P50=${round(percentile(sorted, 50)).padStart(7)}  ` +
      `P95=${round(percentile(sorted, 95)).padStart(7)}  P99=${round(percentile(sorted, 99)).padStart(7)}  ` +
      `max=${round(sorted[sorted.length - 1]).padStart(7)}  mean=${round(mean).padStart(7)} ms`
  )
}

// ---------------------------------------------------------------------------
// 1. dataset report
// ---------------------------------------------------------------------------

async function countNodes(label: string): Promise<number> {
  const response = await hydra.query(`MATCH (n:${label}) RETURN count(*) AS count`, {
    consistency: 'causal',
  })
  const rows = rowsToObjects(response)
  return rows.length ? Number(rows[0].count) : 0
}

async function countEdges(type: string): Promise<number> {
  const response = await hydra.query(`MATCH ()-[r:${type}]->() RETURN count(*) AS count`, {
    consistency: 'causal',
  })
  const rows = rowsToObjects(response)
  return rows.length ? Number(rows[0].count) : 0
}

async function datasetReport(): Promise<void> {
  console.log('\n=== 1. Dataset report ===')
  const labels = ['Package', 'PackageVersion', 'Maintainer', 'Advisory', 'Organization', 'Repository', 'Lockfile', 'Alert']
  const nodeCounts: Record<string, number> = {}
  for (const label of labels) {
    nodeCounts[label] = await countNodes(label)
  }
  const edges = ['HAS_VERSION', 'MAINTAINED_BY', 'DEPENDS_ON', 'AFFECTED_BY', 'OWNS', 'HAS_LOCKFILE', 'RESOLVES']
  const edgeCounts: Record<string, number> = {}
  for (const type of edges) {
    edgeCounts[type] = await countEdges(type)
  }

  for (const label of labels) {
    console.log(`  ${label.padEnd(16)} ${String(nodeCounts[label]).padStart(6)}`)
  }
  console.log(`  ${'-'.repeat(28)}`)
  for (const type of edges) {
    console.log(`  ${type.padEnd(16)} ${String(edgeCounts[type]).padStart(6)}`)
  }
}

// ---------------------------------------------------------------------------
// 2. latency benchmark
// ---------------------------------------------------------------------------

async function timeQuery(query: string, parameters: Record<string, unknown>): Promise<number> {
  const started = performance.now()
  await hydra.query(query, { parameters, consistency: 'causal' })
  return performance.now() - started
}

interface LatencyCase {
  name: string
  fn: () => Promise<number>
}

async function latencyBenchmark(iterations: number): Promise<void> {
  console.log(`\n=== 2. Query latency benchmark (${iterations} iterations each) ===`)

  const targets = [
    { name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
    { name: 'express', version: '4.18.2', ecosystem: 'npm' },
    { name: 'request', version: '2.88.2', ecosystem: 'npm' },
    { name: 'aiohttp', version: '3.8.4', ecosystem: 'PyPI' },
  ]

  const cases: LatencyCase[] = []
  for (const t of targets) {
    cases.push({
      name: `package ${t.name}@${t.version}`,
      fn: () =>
        timeQuery(versionDetailsQuery(t.ecosystem), {
          name: t.name,
          version: t.version,
          ecosystem: t.ecosystem,
        }),
    })
    cases.push({
      name: `dependents ${t.name}@${t.version}`,
      fn: () =>
        timeQuery(dependentsQuery(t.ecosystem), {
          name: t.name,
          version: t.version,
          ecosystem: t.ecosystem,
        }),
    })
    cases.push({
      name: `advisories ${t.name}@${t.version}`,
      fn: () =>
        timeQuery(advisoriesForVersionQuery(t.ecosystem), {
          name: t.name,
          version: t.version,
          ecosystem: t.ecosystem,
        }),
    })
  }

  for (const t of targets) {
    cases.push({
      name: `blast-radius ${t.name}@${t.version} (full)`,
      fn: async () => {
        const started = performance.now()
        await computeBlastRadius(t.name, t.version, t.ecosystem)
        return performance.now() - started
      },
    })
  }

  for (const c of cases) {
    const samples: number[] = []
    for (let i = 0; i < iterations; i++) {
      samples.push(await c.fn())
    }
    summarize(c.name, samples)
  }
}

// ---------------------------------------------------------------------------
// 3. precision / recall against OSV ground truth
// ---------------------------------------------------------------------------

interface Finding {
  app: string
  package: string
  version: string
  advisoryId: string
}

const OSV_CACHE = new Map<string, OsvVulnDoc | null>()

async function fetchOsvVuln(id: string): Promise<OsvVulnDoc | null> {
  if (OSV_CACHE.has(id)) return OSV_CACHE.get(id) ?? null
  const base = env.OSV_API_URL.replace(/\/+$/, '')
  const response = await fetch(`${base}/v1/vulns/${encodeURIComponent(id)}`)
  if (!response.ok) return null
  const doc = (await response.json()) as OsvVulnDoc
  OSV_CACHE.set(id, doc)
  return doc
}

/**
 * Ground truth built independently of the graph: for every app in demo-org,
 * parse its real lockfile, and for each advisory the app's resolved version
 * is linked to, ask OSV directly whether that exact version is affected.
 */
async function osvGroundTruth(): Promise<Finding[]> {
  const manifest = loadDemoOrg(env.DEMO_ORG_PATH)
  if (!manifest) return []

  const apps = manifest.repositories.filter((repo) => repo.kind === 'application')
  const findings: Finding[] = []

  for (const repo of apps) {
    for (const lockfile of repo.lockfiles) {
      const content = readLockfile(env.DEMO_ORG_PATH, lockfile.path)
      if (!content) continue
      const deps = parseLockfile(lockfile.path, lockfile.ecosystem, content)

      for (const dep of deps) {
        // discover advisories affecting this package via OSV querybatch
        const base = env.OSV_API_URL.replace(/\/+$/, '')
        const response = await fetch(`${base}/v1/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package: { ecosystem: lockfile.ecosystem, name: dep.name }, version: dep.resolvedVersion }),
        })
        if (!response.ok) continue
        const doc = (await response.json()) as { vulns?: OsvVulnDoc[] }
        for (const vuln of doc.vulns ?? []) {
          if (vuln.withdrawn) continue
          const affected = (vuln.affected ?? []).find(
            (a) =>
              a.package?.name === dep.name &&
              a.package?.ecosystem?.toLowerCase() === lockfile.ecosystem.toLowerCase()
          )
          if (!affected) continue
          if (testOsvAffected(affected, dep.resolvedVersion)) {
            findings.push({ app: repo.name, package: dep.name, version: dep.resolvedVersion, advisoryId: vuln.id })
          }
        }
      }
    }
  }

  return findings
}

/**
 * Predicted set from the graph: for every app in demo-org, every resolved
 * version that carries an AFFECTED_BY edge to a real advisory in HydraDB.
 */
async function graphPredictions(): Promise<Finding[]> {
  const manifest = loadDemoOrg(env.DEMO_ORG_PATH)
  if (!manifest) return []

  const apps = manifest.repositories.filter((repo) => repo.kind === 'application')
  const findings: Finding[] = []

  for (const repo of apps) {
    const response = await hydra.query(
      `
      MATCH (l:Lockfile {repository: $repo})-[:RESOLVES]->(v:PackageVersion)-[:AFFECTED_BY]->(a:Advisory)
      RETURN v.name AS name, v.version AS version, a.advisory_id AS advisoryId
      ORDER BY v.name, v.version, a.advisory_id
      `,
      { parameters: { repo: repo.name }, consistency: 'causal' }
    )
    const rows = rowsToObjects(response)
    for (const row of rows) {
      findings.push({
        app: repo.name,
        package: String(row.name),
        version: String(row.version),
        advisoryId: String(row.advisoryId),
      })
    }
  }

  return findings
}

function key(f: Finding): string {
  return `${f.app}|${f.package}|${f.version}|${f.advisoryId}`
}

function appVersionKey(f: Finding): string {
  return `${f.app}|${f.package}|${f.version}`
}

async function precisionRecall(): Promise<void> {
  console.log('\n=== 3. Precision / recall vs OSV ground truth ===')
  console.log('  demo-org apps only')

  const truth = await osvGroundTruth()
  const predicted = await graphPredictions()

  // 3a. Exposure level: does the app resolve a version OSV says is vulnerable?
  //     The track's core question ("which apps are exposed"), normalized across
  //     advisory databases (npm-audit-* vs GHSA-* can describe the same bug).
  const truthExposure = new Set(truth.map(appVersionKey))
  const predictedExposure = new Set(predicted.map(appVersionKey))
  const tpExposure = [...predictedExposure].filter((k) => truthExposure.has(k)).length
  const precisionExposure = predictedExposure.size ? tpExposure / predictedExposure.size : 0
  const recallExposure = truthExposure.size ? tpExposure / truthExposure.size : 0
  const f1Exposure = precisionExposure + recallExposure ? (2 * precisionExposure * recallExposure) / (precisionExposure + recallExposure) : 0

  console.log(`\n  [Exposure] (app|package|version) — normalized across advisory DBs`)
  console.log(`  OSV ground-truth exposed app-versions : ${String(truthExposure.size).padStart(4)}`)
  console.log(`  Graph-predicted exposed app-versions  : ${String(predictedExposure.size).padStart(4)}`)
  console.log(`  True positives                        : ${String(tpExposure).padStart(4)}`)
  console.log(`  Precision                             : ${precisionExposure.toFixed(3)}`)
  console.log(`  Recall                                : ${recallExposure.toFixed(3)}`)
  console.log(`  F1                                    : ${f1Exposure.toFixed(3)}`)

  const fpExposure = [...predictedExposure].filter((k) => !truthExposure.has(k))
  const fnExposure = [...truthExposure].filter((k) => !predictedExposure.has(k))
  if (fpExposure.length) {
    console.log(`\n  Exposure false positives (${fpExposure.length}):`)
    for (const k of fpExposure) console.log(`    - ${k}`)
  }
  if (fnExposure.length) {
    console.log(`\n  Exposure false negatives (${fnExposure.length}):`)
    for (const k of fnExposure) console.log(`    - ${k}`)
  }

  // 3b. Advisory-level (strict, same advisory ID on both sides).
  const truthKeys = new Set(truth.map(key))
  const predictedKeys = new Set(predicted.map(key))
  const truePositive = [...predictedKeys].filter((k) => truthKeys.has(k)).length
  const precision = predictedKeys.size ? truePositive / predictedKeys.size : 0
  const recall = truthKeys.size ? truePositive / truthKeys.size : 0
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0

  console.log(`\n  [Advisory] (app|package|version|advisoryId) — strict identity`)
  console.log(`  OSV ground-truth findings : ${String(truthKeys.size).padStart(4)}`)
  console.log(`  Graph-predicted findings  : ${String(predictedKeys.size).padStart(4)}`)
  console.log(`  True positives            : ${String(truePositive).padStart(4)}`)
  console.log(`  Precision                 : ${precision.toFixed(3)}`)
  console.log(`  Recall                    : ${recall.toFixed(3)}`)
  console.log(`  F1                        : ${f1.toFixed(3)}`)
  console.log('  (Advisory-ID identity is DB-specific: npm-audit-* vs GHSA-* can\n   describe the same bug, so the exposure-level metric is the fair one.)')
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const help = args.includes('--help') || args.includes('-h')
  if (help) {
    console.log(`Usage:
  bun run bench         dataset report + query latency
  bun run bench:all     dataset + latency + precision/recall (hits OSV API)
  bun run bench --iter N   override iteration count (default 20)
`)
    return
  }
  const iterIndex = args.indexOf('--iter')
  const iterArg = iterIndex !== -1 ? args[iterIndex + 1] : args.find((a) => a.startsWith('--iter='))?.split('=')[1]
  const iterations = iterArg ? Number(iterArg) : 20
  const runEval = args.includes('--eval') || process.argv[1]?.includes('bench:all')

  await datasetReport()
  await latencyBenchmark(iterations)
  if (runEval) await precisionRecall()
  console.log('\nDone.')
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('benchmark failed:', error)
    process.exit(1)
  })
}
