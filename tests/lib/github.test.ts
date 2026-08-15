import { describe, expect, it } from 'bun:test'
import { parseRepo, MANIFEST_CANDIDATES } from '../../src/lib/github'
import { AppError } from '../../src/lib/errors'

describe('parseRepo', () => {
  it('accepts owner/repo', () => {
    expect(parseRepo('acme/payments-api')).toEqual({ owner: 'acme', name: 'payments-api' })
  })

  it('normalizes full GitHub URLs and trailing .git', () => {
    expect(parseRepo('https://github.com/acme/payments-api.git')).toEqual({
      owner: 'acme',
      name: 'payments-api',
    })
  })

  it('rejects malformed repo refs', () => {
    expect(() => parseRepo('just-one-segment')).toThrow(AppError)
    expect(() => parseRepo('')).toThrow(AppError)
  })
})

describe('MANIFEST_CANDIDATES', () => {
  it('covers npm and Python lockfiles', () => {
    expect(MANIFEST_CANDIDATES).toEqual(
      expect.arrayContaining([
        'package.json',
        'package-lock.json',
        'bun.lock',
        'yarn.lock',
        'requirements.txt',
        'pyproject.toml',
        'uv.lock',
      ])
    )
  })
})
