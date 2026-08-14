import { parseNpmPackageLock } from './npm-lockfile'
import { parseRequirements } from './requirements'
import { parseUvLock } from './uv-lock'
import type { Ecosystem, ResolvedDependency } from '../types'

export function parseLockfile(path: string, ecosystem: Ecosystem, content: string): ResolvedDependency[] {
  if (ecosystem === 'npm') {
    if (path.endsWith('package-lock.json')) return parseNpmPackageLock(content)
    if (path.endsWith('pnpm-lock.yaml')) throw new Error('pnpm-lock.yaml parsing is not implemented yet')
    if (path.endsWith('yarn.lock')) throw new Error('yarn.lock parsing is not implemented yet')
    throw new Error(`unsupported npm lockfile: ${path}`)
  }
  if (path.endsWith('uv.lock')) return parseUvLock(content)
  if (path.endsWith('.txt')) return parseRequirements(content)
  throw new Error(`unsupported lockfile for ecosystem '${ecosystem}': ${path}`)
}

export { parseNpmPackageLock } from './npm-lockfile'
export { parseRequirements } from './requirements'
export { parseUvLock } from './uv-lock'
