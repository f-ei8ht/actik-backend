import type { ResolvedDependency } from '../types'

function splitSections(content: string): string[] {
  const lines = content.split('\n')
  const sections: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.startsWith('[[package]]')) {
      if (current.length > 0) sections.push(current.join('\n'))
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) sections.push(current.join('\n'))
  return sections
}

function stringValue(section: string, key: string): string | undefined {
  const match = section.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))
  return match?.[1]
}

function isProjectSection(section: string): boolean {
  const source = stringValue(section, 'source')
  if (source) return source.includes('editable') || source.includes('directory')
  return /^\s*source\s*=\s*\{\s*(editable|directory|workspace)\s*=/m.test(section)}

export function parseUvLock(content: string): ResolvedDependency[] {
  const deps: ResolvedDependency[] = []
  for (const section of splitSections(content)) {
    if (isProjectSection(section)) continue
    const name = stringValue(section, 'name')
    const version = stringValue(section, 'version')
    if (!name || !version) continue
    deps.push({ ecosystem: 'PyPI', name, resolvedVersion: version })
  }
  return deps.sort((a, b) => a.name.localeCompare(b.name))
}
