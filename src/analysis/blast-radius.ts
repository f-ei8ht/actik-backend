import { decodeValue, hydra, rowsToObjects, type Path } from '../hydra/client'
import {
  blastRadiusQuery,
  lookupPackageIdQuery,
} from '../hydra/queries'

export interface BlastDependency {
  name: string
  version: string
}

export interface BlastPath {
  path: string[]
  depth: number
}

export interface BlastRadiusResult {
  directDependents: BlastDependency[]
  transitiveDependents: BlastDependency[]
  maxDepth: number
  count: number
  paths: BlastPath[]
  latencyMs: number
}

export async function resolveVersionId(name: string, version: string): Promise<number | null> {
  const response = await hydra.query(lookupPackageIdQuery, {
    parameters: { name, version },
    consistency: 'causal',
  })
  const rows = rowsToObjects(response)
  return rows.length ? Number(rows[0].id) : null
}

export async function computeBlastRadius(
  name: string,
  version: string,
  maxDepth = 10,
  maxPaths = 100
): Promise<BlastRadiusResult | null> {
  const source = await resolveVersionId(name, version)
  if (source === null) return null

  const startedAt = performance.now()
  const response = await hydra.query(blastRadiusQuery(maxDepth), {
    parameters: { source },
    consistency: 'causal',
  })
  const latencyMs = performance.now() - startedAt

  const seenDependents = new Set<number>()
  const transitiveDependents: BlastDependency[] = []
  const directDependents: BlastDependency[] = []
  const paths: BlastPath[] = []

  for (const row of response.rows) {
    const path = decodeValue(row[0]) as Path
    const pathNames = path.nodes.map((node) => {
      const props = node.properties as Record<string, unknown>
      return `${props.name}@${props.version}`
    })
    const last = path.nodes[path.nodes.length - 1]
    const depth = path.nodes.length - 1
    if (!last || last.id === source) continue

    const dependent = {
      name: String(last.properties.name),
      version: String(last.properties.version),
    }
    if (!seenDependents.has(last.id)) {
      seenDependents.add(last.id)
      transitiveDependents.push(dependent)
    }
    if (depth === 1 && !directDependents.some((d) => d.name === dependent.name)) {
      directDependents.push(dependent)
    }
    if (paths.length < maxPaths) {
      paths.push({ path: pathNames.reverse(), depth })
    }
  }

  const maxDepthFound = response.rows.reduce(
    (max, row) => {
      const path = decodeValue(row[0]) as Path
      return Math.max(max, path.nodes.length - 1)
    },
    0
  )

  return {
    directDependents,
    transitiveDependents,
    maxDepth: maxDepthFound,
    count: transitiveDependents.length,
    paths,
    latencyMs: Math.round(latencyMs),
  }
}
