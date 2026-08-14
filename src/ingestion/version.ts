export interface OsvRangeEvent {
  introduced?: string
  fixed?: string
  last_affected?: string
}

export interface OsvAffectedRange {
  events: OsvRangeEvent[]
}

export interface OsvAffected {
  package?: { name?: string; ecosystem?: string }
  versions?: string[]
  ranges?: OsvAffectedRange[]
}

export interface OsvVulnDoc {
  id: string
  summary?: string
  details?: string
  published?: string
  modified?: string
  withdrawn?: string
  severity?: Array<{ type?: string; score?: string | number }>
  database_specific?: Record<string, unknown>
  references?: Array<{ type?: string; url?: string }>
  affected?: OsvAffected[]
}

export type VersionParts = Array<number | string>

export function parseVersion(version: string): VersionParts {
  const withoutBuild = version.trim().toLowerCase().split('+')[0]
  return withoutBuild.split(/[.\-]/).map((segment) => {
    const numeric = Number(segment)
    return Number.isNaN(numeric) ? segment : numeric
  })
}

function isNumeric(value: number | string): boolean {
  return typeof value === 'number'
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const l = left[i]
    const r = right[i]
    if (l === undefined && r === undefined) return 0
    if (l === undefined) return isNumeric(r) ? -1 : 1
    if (r === undefined) return isNumeric(l) ? 1 : -1
    if (typeof l === 'number' && typeof r === 'number') {
      if (l !== r) return l < r ? -1 : 1
    } else {
      const ls = String(l)
      const rs = String(r)
      if (ls !== rs) return ls < rs ? -1 : 1
    }
  }
  return 0
}

export function versionInRangeEvents(events: OsvRangeEvent[], version: string): boolean {
  let minimum: string | null = null
  let fixed: string | null = null
  let lastAffected: string | null = null
  for (const event of events) {
    if (event.introduced !== undefined && event.introduced !== '0') minimum = event.introduced
    if (event.fixed !== undefined) fixed = event.fixed
    if (event.last_affected !== undefined) lastAffected = event.last_affected
  }
  if (minimum !== null && compareVersions(version, minimum) < 0) return false
  if (fixed !== null && compareVersions(version, fixed) >= 0) return false
  if (lastAffected !== null && compareVersions(version, lastAffected) > 0) return false
  return true
}

export function testOsvAffected(affected: OsvAffected, version: string): boolean {
  if (Array.isArray(affected.versions) && affected.versions.includes(version)) return true
  if (!Array.isArray(affected.ranges)) return false
  return affected.ranges.some((range) => versionInRangeEvents(range.events ?? [], version))
}

function pad(parts: VersionParts, length: number): VersionParts {
  const padded = parts.slice(0, length)
  while (padded.length < length) padded.push(0)
  return padded
}

function gte(version: string, minimum: string): boolean {
  return compareVersions(version, minimum) >= 0
}

function lte(version: string, maximum: string): boolean {
  return compareVersions(version, maximum) <= 0
}

function wildcardPrefix(spec: string): number[] {
  const cleaned = spec.trim().toLowerCase().replace(/\*/g, 'x')
  if (cleaned === 'x') return []
  const segments: number[] = []
  for (const segment of cleaned.split('.')) {
    if (segment === 'x') break
    if (!segment) continue
    const value = Number(segment)
    if (Number.isNaN(value)) return segments
    segments.push(value)
  }
  return segments
}

function matchesWildcard(prefix: number[], version: string): boolean {
  const parts = parseVersion(version)
  return prefix.every((value, index) => parts[index] === value)
}

function nextMajorBoundary(spec: string): string {
  const parts = pad(parseVersion(spec), 3)
  return `${(parts[0] as number) + 1}.0.0`
}

function nextMinorBoundary(spec: string): string {
  const parts = pad(parseVersion(spec), 3)
  return `${parts[0] as number}.${(parts[1] as number) + 1}.0`
}

function nextPatchBoundary(spec: string): string {
  const parts = pad(parseVersion(spec), 3)
  return `${parts[0] as number}.${parts[1] as number}.${(parts[2] as number) + 1}`
}

function testComparator(comparator: string, version: string): boolean {
  const match = comparator.trim().match(/^(>=|<=|>|<|=|~|\^)?\s*(.+)$/)
  if (!match) return false
  const operator = match[1] ?? '='
  const spec = match[2]
  const prefix = wildcardPrefix(spec)
  const isWildcard = prefix.length < spec.split('.').length || spec.trim().toLowerCase().includes('x')

  switch (operator) {
    case '>':
      return isWildcard ? false : compareVersions(version, spec) > 0
    case '>=':
      return isWildcard ? matchesWildcard(prefix, version) && gte(version, spec) : gte(version, spec)
    case '<':
      return isWildcard ? false : compareVersions(version, spec) < 0
    case '<=':
      return isWildcard ? matchesWildcard(prefix, version) && lte(version, spec) : lte(version, spec)
    case '~': {
      const segments = wildcardPrefix(spec)
      if (segments.length <= 1) return gte(version, spec) && compareVersions(version, nextMajorBoundary(spec)) < 0
      return gte(version, spec) && compareVersions(version, nextMinorBoundary(spec)) < 0
    }
    case '^': {
      const segments = wildcardPrefix(spec)
      if (segments.length === 0) return true
      if (segments[0] > 0) return gte(version, spec) && compareVersions(version, nextMajorBoundary(spec)) < 0
      if (segments[1] > 0) return gte(version, spec) && compareVersions(version, nextMinorBoundary(spec)) < 0
      if (segments[2] > 0) return gte(version, spec) && compareVersions(version, nextPatchBoundary(spec)) < 0
      return gte(version, spec) && compareVersions(version, nextMinorBoundary(spec)) < 0
    }
    default:
      return isWildcard ? matchesWildcard(prefix, version) : compareVersions(version, spec) === 0
  }
}

export function testNpmRange(range: string | null | undefined, version: string): boolean {
  if (!range) return true
  return range.split('||').some((group) => {
    const trimmed = group.trim()
    if (!trimmed || trimmed === '*') return true
    const hyphen = trimmed.split(/\s+-\s+/)
    if (hyphen.length === 2) {
      return gte(version, hyphen[0]) && lte(version, hyphen[1])
    }
    return trimmed.split(/\s+/).every((comparator) => testComparator(comparator, version))
  })
}
