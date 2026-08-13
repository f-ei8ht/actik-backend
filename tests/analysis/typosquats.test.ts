import { describe, expect, it } from 'bun:test'
import { levenshtein, rankCandidates, similarityScore } from '../../src/analysis/typosquats'

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('lodash', 'lodash')).toBe(0)
    expect(levenshtein('lodash', 'lodahs')).toBe(2)
    expect(levenshtein('lodash', 'lodash-js')).toBe(3)
    expect(levenshtein('lodash', 'react')).toBe(5)
  })
})

describe('similarityScore', () => {
  it('returns 1 for identical names', () => {
    expect(similarityScore('lodash', 'lodash')).toBe(1)
  })

  it('scores near matches above distant ones', () => {
    expect(similarityScore('lodash', 'lodahs')).toBeGreaterThan(similarityScore('lodash', 'react'))
  })
})

describe('rankCandidates', () => {
  it('filters and ranks typosquat candidates', () => {
    const candidates = rankCandidates('lodash', ['lodash', 'lodahs', 'lodash-js', 'react', 'express'])
    expect(candidates.some((c) => c.name === 'lodash')).toBe(false)
    expect(candidates[0].name).toBe('lodahs')
    expect(candidates[0].similarity).toBeGreaterThan(0.5)
  })

  it('respects the similarity threshold', () => {
    const candidates = rankCandidates('lodash', ['lodash-xyzzy-plugh', 'react'], 0.8)
    expect(candidates).toHaveLength(0)
  })
})
