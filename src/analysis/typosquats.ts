export interface TyposquatCandidate {
  name: string
  version: string
  description: string
  popularity: number
  similarity: number
  editDistance: number
  factors: string[]
  risk: number
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'
  reason: string
}

export function levenshtein(a: string, b: string): number {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length

  const rows = new Array<number>(right.length + 1)
  for (let j = 0; j <= right.length; j++) rows[j] = j
  for (let i = 1; i <= left.length; i++) {
    let previous = rows[0]
    rows[0] = i
    for (let j = 1; j <= right.length; j++) {
      const current = rows[j]
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + cost)
      previous = current
    }
  }
  return rows[right.length]
}

export function similarityScore(a: string, b: string): number {
  if (a === b) return 1
  const distance = levenshtein(a, b)
  const maxLength = Math.max(a.length, b.length)
  return maxLength === 0 ? 1 : 1 - distance / maxLength
}

function baseName(name: string): string {
  return name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name
}

function listFactors(target: string, candidate: string, distance: number): string[] {
  const factors: string[] = []
  const t = target.toLowerCase()
  const c = candidate.toLowerCase()
  const tb = baseName(t)
  const cb = baseName(c)

  if (tb.length === cb.length && distance <= 2) factors.push('character-substitution')
  if (Math.abs(tb.length - cb.length) === 1 && distance <= 1) {
    factors.push(cb.length > tb.length ? 'extra-character' : 'missing-character')
  }
  if (c.startsWith(t + '-') || t.startsWith(c + '-')) factors.push('hyphenated')
  if (t.split('-').join('') === c || c.split('-').join('') === t) factors.push('hyphenated')
  if ((t.startsWith('@') !== c.startsWith('@')) && (tb === cb || similarityScore(tb, cb) >= 0.9)) {
    factors.push('scoped-vs-unscoped')
  }
  if (distance === 1) factors.push('single-character-diff')
  return factors
}

function computeRisk(similarity: number, distance: number, factors: string[], popularity: number): {
  risk: number
  level: TyposquatCandidate['level']
} {
  let risk = 0
  if (similarity >= 0.9) risk += 50
  else if (similarity >= 0.75) risk += 35
  else if (similarity >= 0.6) risk += 20

  if (distance <= 1) risk += 15
  if (factors.includes('hyphenated') || factors.includes('scoped-vs-unscoped')) risk += 15
  if (popularity < 0.3) risk += 20

  risk = Math.min(100, risk)
  const level: TyposquatCandidate['level'] =
    risk >= 80 ? 'CRITICAL' : risk >= 60 ? 'HIGH' : risk >= 40 ? 'MODERATE' : 'LOW'
  return { risk, level }
}

export function rankCandidates(
  target: string,
  candidates: Array<{ name: string; version?: string; description?: string; popularity?: number } | string>,
  threshold = 0.55
): TyposquatCandidate[] {
  const normalized: Array<{ name: string; version: string; description: string; popularity: number }> =
    candidates.map((entry) =>
      typeof entry === 'string'
        ? { name: entry, version: '', description: '', popularity: 0.5 }
        : {
            name: entry.name,
            version: entry.version ?? '',
            description: entry.description ?? '',
            popularity: typeof entry.popularity === 'number' ? entry.popularity : 0.5,
          }
    )

  return normalized
    .filter((candidate) => candidate.name && candidate.name.toLowerCase() !== target.toLowerCase())
    .map((candidate) => {
      const scopedMismatch = target.startsWith('@') !== candidate.name.startsWith('@')
      const a = scopedMismatch ? baseName(target) : target
      const b = scopedMismatch ? baseName(candidate.name) : candidate.name
      const distance = levenshtein(a, b)
      const similarity = similarityScore(a, b)
      return { candidate, distance, similarity }
    })
    .filter(({ similarity }) => similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .map(({ candidate, distance, similarity }) => {
      const factors = listFactors(target, candidate.name, distance)
      const { risk, level } = computeRisk(similarity, distance, factors, candidate.popularity)
      const reason = [
        `name ${(similarity * 100).toFixed(0)}% similar`,
        ...factors,
        candidate.popularity < 0.3 ? 'low popularity' : '',
      ]
        .filter(Boolean)
        .join(', ')
      return {
        name: candidate.name,
        version: candidate.version,
        description: candidate.description,
        popularity: candidate.popularity,
        similarity,
        editDistance: distance,
        factors,
        risk,
        level,
        reason,
      }
    })
}
