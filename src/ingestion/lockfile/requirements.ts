import type { ResolvedDependency } from '../types'

export function parseRequirements(content: string): ResolvedDependency[] {
  const deps: ResolvedDependency[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.split('#')[0].trim()
    if (!line || line.startsWith('-') || line.startsWith('.')) continue
    const match = line.match(/^([A-Za-z0-9._-]+)\s*==\s*([A-Za-z0-9.+-]+)/)
    if (!match) continue
    deps.push({
      ecosystem: 'PyPI',
      name: match[1],
      requestedVersion: match[2],
      resolvedVersion: match[2],
    })
  }
  return deps.sort((a, b) => a.name.localeCompare(b.name))
}
