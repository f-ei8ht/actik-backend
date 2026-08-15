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

  // Every node_modules path is a distinct resolution: npm allows the same
  // package at different versions under nested node_modules, so `name` alone
  // is not enough. Dedupe by (path, version) but keep every distinct version.
  const resolved = new Map<string, ResolvedDependency>()
  if (doc.packages) {
    for (const [key, entry] of Object.entries(doc.packages)) {
      if (key === '' || !entry?.version) continue
      const name = nameFromLockfileKey(key)
      if (!name) continue
      resolved.set(`${key}:${entry.version}`, {
        ecosystem: 'npm' as const,
        name,
        requestedVersion: requested.get(name),
        resolvedVersion: entry.version,
        path: key,
      })
    }
  } else if (doc.dependencies) {
    for (const [name, entry] of Object.entries(doc.dependencies)) {
      if (!entry?.version) continue
      resolved.set(`${name}:${entry.version}`, {
        ecosystem: 'npm' as const,
        name,
        requestedVersion: requested.get(name),
        resolvedVersion: entry.version,
        path: `node_modules/${name}`,
      })
    }
  }

  return [...resolved.values()].sort((a, b) => a.name.localeCompare(b.name))
}
