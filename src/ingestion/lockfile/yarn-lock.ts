import type { ResolvedDependency } from '../types'

/**
 * yarn.lock (v1 "classic") — block-per-selector format. Each block header is
 * one or more comma-separated `name@range` selectors; the block body carries
 * `version "x.y.z"`. Parsed line-by-line because generic YAML parsers choke
 * on the comma-separated quoted keys.
 */
export function parseYarnLock(content: string): ResolvedDependency[] {
  const deps: ResolvedDependency[] = []
  const seen = new Set<string>()

  let currentKey: string | null = null
  let currentVersion: string | null = null

  const flush = () => {
    if (currentKey && currentVersion) {
      for (const part of currentKey.split(',')) {
        const parsed = parseYarnKey(part.trim())
        if (!parsed) continue
        const dedupe = `${parsed.name}:${currentVersion}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        deps.push({
          ecosystem: 'npm' as const,
          name: parsed.name,
          requestedVersion: parsed.range,
          resolvedVersion: currentVersion,
          path: `node_modules/${parsed.name}`,
        })
      }
    }
    currentKey = null
    currentVersion = null
  }

  for (const line of content.split('\n')) {
    if (/^\s*#/.test(line)) continue
    if (/^\s*$/.test(line)) {
      flush()
      continue
    }
    if (!/^\s/.test(line)) {
      flush()
      const match = line.match(/^(.*):\s*$/)
      currentKey = match ? match[1].trim() : null
      continue
    }
    const versionMatch = line.match(/^\s+version\s+["']?([^"'#\s]+)/)
    if (versionMatch) currentVersion = versionMatch[1]
  }
  flush()

  return deps.sort((a, b) => a.name.localeCompare(b.name))
}

function parseYarnKey(raw: string): { name: string; range?: string } | null {
  const key = raw.replace(/^"(.*)"$/, '$1').trim()
  if (!key) return null
  const at = key.lastIndexOf('@')
  if (at <= 0) return { name: key }
  const name = key.slice(0, at)
  if (!name || (name.startsWith('@') && !name.includes('/'))) return { name: key }
  const range = key.slice(at + 1)
  return { name, range: range.startsWith('npm:') ? range.slice(4) : range }
}
