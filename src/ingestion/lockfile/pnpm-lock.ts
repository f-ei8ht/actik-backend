import type { ResolvedDependency } from '../types'

interface PnpmImporters {
  [importPath: string]: {
    dependencies?: Record<string, { specifier?: string; version?: string }>
    devDependencies?: Record<string, { specifier?: string; version?: string }>
    optionalDependencies?: Record<string, { specifier?: string; version?: string }>
  }
}

interface PnpmLockfileDoc {
  lockfileVersion?: string
  importers?: PnpmImporters
  packages?: Record<string, unknown>
}

function parsePnpmPackageKey(key: string): { name: string; version: string } | null {
  const match = key.match(/^(.*)@([0-9][A-Za-z0-9.+-]*)(?:\(.*\))?$/)
  if (!match) return null
  const name = match[1]
  if (!name) return null
  if (name.startsWith('@') && !name.includes('/')) return null
  if (name.includes('/') && !name.startsWith('@')) return null
  return { name, version: match[2] }
}

function registryVersion(version: string | undefined): string | null {
  if (!version) return null
  if (version.startsWith('link:') || version.startsWith('workspace:') || version.startsWith('file:')) return null
  if (!/^[0-9]/.test(version)) return null
  return version.replace(/\(.*\)$/, '')
}

/**
 * pnpm-lock.yaml (lockfileVersion 6/9). The `packages` map keys
 * (`name@version(peers)`) enumerate every resolved version; importers record
 * the requested specifier per direct dependency.
 */
export function parsePnpmLock(content: string): ResolvedDependency[] {
  const doc = Bun.YAML.parse(content) as PnpmLockfileDoc

  const requested = new Map<string, string>()
  for (const importer of Object.values(doc.importers ?? {})) {
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      for (const [name, entry] of Object.entries(importer?.[group] ?? {})) {
        if (entry?.specifier) requested.set(name, entry.specifier)
      }
    }
  }

  const resolved = new Map<string, ResolvedDependency>()
  for (const key of Object.keys(doc.packages ?? {})) {
    const parsed = parsePnpmPackageKey(key)
    if (!parsed) continue
    const dedupe = `${parsed.name}:${parsed.version}`
    if (resolved.has(dedupe)) continue
    resolved.set(dedupe, {
      ecosystem: 'npm' as const,
      name: parsed.name,
      requestedVersion: requested.get(parsed.name),
      resolvedVersion: parsed.version,
      path: `node_modules/${parsed.name}`,
    })
  }

  // Importers may resolve direct deps not enumerated under `packages` (rare
  // with linked/local packages) — only include registry versions.
  for (const importer of Object.values(doc.importers ?? {})) {
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      for (const [name, entry] of Object.entries(importer?.[group] ?? {})) {
        const version = registryVersion(entry?.version)
        if (!version) continue
        const dedupe = `${name}:${version}`
        if (resolved.has(dedupe)) continue
        resolved.set(dedupe, {
          ecosystem: 'npm' as const,
          name,
          requestedVersion: entry?.specifier,
          resolvedVersion: version,
          path: `node_modules/${name}`,
        })
      }
    }
  }

  return [...resolved.values()].sort((a, b) => a.name.localeCompare(b.name))
}
