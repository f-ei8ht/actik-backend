export interface TyposquatCandidate {
  name: string
  version: string
  description: string
  similarity: number
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

export function rankCandidates(target: string, candidates: string[], threshold = 0.55): TyposquatCandidate[] {
  return candidates
    .filter((candidate) => candidate && candidate.toLowerCase() !== target.toLowerCase())
    .map((candidate) => ({ candidate, similarity: similarityScore(target, candidate) }))
    .filter(({ similarity }) => similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .map(({ candidate, similarity }) => ({
      name: candidate,
      version: '',
      description: '',
      similarity,
    }))
}
