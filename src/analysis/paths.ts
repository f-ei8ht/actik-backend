import { decodeValue, type Path } from '../hydra/client'
import type { QueryResponse } from '../hydra/schema'

export interface AffectedVersion {
  name: string
  version: string
}

export interface PropagationPath {
  path: string[]
  depth: number
}

export interface PathSummary {
  directDependents: AffectedVersion[]
  transitiveDependents: AffectedVersion[]
  maxDepth: number
  paths: PropagationPath[]
  affectedVersionIds: number[]
}

export function summarizePaths(
  rows: QueryResponse['rows'],
  sourceId: number,
  maxPaths = 100
): PathSummary {
  const seen = new Set<number>()
  const affectedVersionIds = new Set<number>([sourceId])
  const directDependents: AffectedVersion[] = []
  const transitiveDependents: AffectedVersion[] = []
  const paths: PropagationPath[] = []
  let maxDepth = 0

  for (const row of rows) {
    const path = decodeValue(row[0]) as Path
    const depth = path.nodes.length - 1
    maxDepth = Math.max(maxDepth, depth)

    const last = path.nodes[path.nodes.length - 1]
    if (!last || last.id === sourceId) continue
    affectedVersionIds.add(last.id)

    const dependent = {
      name: String(last.properties.name),
      version: String(last.properties.version),
    }
    if (!seen.has(last.id)) {
      seen.add(last.id)
      transitiveDependents.push(dependent)
    }
    if (depth === 1 && !directDependents.some((entry) => entry.name === dependent.name)) {
      directDependents.push(dependent)
    }
    if (paths.length < maxPaths) {
      const pathNames = path.nodes.map((node) => {
        const props = node.properties as Record<string, unknown>
        return `${props.name}@${props.version}`
      })
      paths.push({ path: pathNames.reverse(), depth })
    }
  }

  return {
    directDependents,
    transitiveDependents,
    maxDepth,
    paths,
    affectedVersionIds: [...affectedVersionIds],
  }
}
