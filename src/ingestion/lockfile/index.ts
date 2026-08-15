import { parseNpmPackageLock } from './npm-lockfile'
import { parsePnpmLock } from './pnpm-lock'
import { parseRequirements } from './requirements'
import { parseUvLock } from './uv-lock'
import { parseYarnLock } from './yarn-lock'
import type { Ecosystem, ResolvedDependency } from '../types'

export function parseLockfile(path: string, ecosystem: Ecosystem, content: string): ResolvedDependency[] {
  if (ecosystem === 'npm') {
    if (path.endsWith('package-lock.json')) return parseNpmPackageLock(content)
    if (path.endsWith('pnpm-lock.yaml')) return parsePnpmLock(content)
    if (path.endsWith('yarn.lock')) return parseYarnLock(content)
    if (path.endsWith('bun.lock')) return parseBunLock(content)
    if (path.endsWith('bun.lockb')) throw new Error('binary bun.lockb is not supported; commit bun.lock as text instead')
    throw new Error(`unsupported npm lockfile: ${path}`)
  }
  if (path.endsWith('uv.lock')) return parseUvLock(content)
  if (path.endsWith('.txt')) return parseRequirements(content)
  throw new Error(`unsupported lockfile for ecosystem '${ecosystem}': ${path}`)
}

export { parseNpmPackageLock } from './npm-lockfile'
export { parsePnpmLock } from './pnpm-lock'
export { parseRequirements } from './requirements'
export { parseUvLock } from './uv-lock'
export { parseYarnLock } from './yarn-lock'

/**
 * bun.lock is a YAML document whose package entries are keyed
 * `name@version` under a top-level `packages` map.
 */
export function parseBunLock(content: string): ResolvedDependency[] {
  const doc = Bun.YAML.parse(content) as { packages?: Record<string, unknown> }
  const deps: ResolvedDependency[] = []
  const seen = new Set<string>()
  for (const key of Object.keys(doc.packages ?? {})) {
    const match = key.match(/^(.*)@([0-9][A-Za-z0-9.+-]*)$/)
    if (!match) continue
    const name = match[1]
    const version = match[2]
    if (!name || (name.startsWith('@') && !name.includes('/'))) continue
    const dedupe = `${name}:${version}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    deps.push({
      ecosystem: 'npm' as const,
      name,
      resolvedVersion: version,
      path: `node_modules/${name}`,
    })
  }
  return deps.sort((a, b) => a.name.localeCompare(b.name))
}
