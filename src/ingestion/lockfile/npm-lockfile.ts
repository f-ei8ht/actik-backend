import type { ResolvedDependency } from '../types'

interface NpmLockfilePackageEntry {
  name?: string
  version?: string
  dependencies?: Record<string, string>
}

interface NpmLockfileDependencyEntry {
  version?: string
  requires?: Record<string, string>
}

interface NpmLockfileDoc {
  lockfileVersion?: number
  packages?: Record<string, NpmLockfilePackageEntry>
  dependencies?: Record<string, NpmLockfileDependencyEntry>
}

function nameFromLockfileKey(key: string): string | null {
  const scoped = key.match(/node_modules\/(@[^/]+\/[^/]+)$/)
  if (scoped) return scoped[1]
  const plain = key.match(/node_modules\/([^/]+)$/)
  if (plain) return plain[1]
  return null
}

export function parseNpmPackageLock(content: string): ResolvedDependency[] {
  const doc = JSON.parse(content) as NpmLockfileDoc

  const requested = new Map<string, string>()
  const root = doc.packages?.['']
  if (root?.dependencies) {
    for (const [name, range] of Object.entries(root.dependencies)) {
      requested.set(name, range)
    }
  }
  if (doc.dependencies) {
    for (const [name, entry] of Object.entries(doc.dependencies)) {
      if (entry?.requires) {
        for (const [depName, range] of Object.entries(entry.requires)) {
          if (!requested.has(depName)) requested.set(depName, range)
        }
      }
    }
  }

  const resolved = new Map<string, string>()
  if (doc.packages) {
    for (const [key, entry] of Object.entries(doc.packages)) {
      if (key === '' || !entry?.version) continue
      const name = nameFromLockfileKey(key)
      if (name) resolved.set(name, entry.version)
    }
  } else if (doc.dependencies) {
    for (const [name, entry] of Object.entries(doc.dependencies)) {
      if (entry?.version) resolved.set(name, entry.version)
    }
  }

  return [...resolved]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, resolvedVersion]) => ({
      ecosystem: 'npm' as const,
      name,
      requestedVersion: requested.get(name),
      resolvedVersion,
    }))
}
