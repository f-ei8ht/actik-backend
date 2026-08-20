import { describe, expect, it } from 'bun:test'
import { parseRepo, repoLabel, MANIFEST_CANDIDATES } from '../../src/lib/vcs'
import { AppError } from '../../src/lib/errors'

describe('parseRepo', () => {
  it('defaults to GitHub for owner/repo', () => {
    expect(parseRepo('acme/payments-api')).toEqual({
      host: 'github',
      owner: 'acme',
      name: 'payments-api',
    })
  })

  it('normalizes full GitHub URLs and trailing .git', () => {
    expect(parseRepo('https://github.com/acme/payments-api.git')).toEqual({
      host: 'github',
      owner: 'acme',
      name: 'payments-api',
    })
  })

  it('detects GitLab URLs', () => {
    expect(parseRepo('https://gitlab.com/group/project')).toEqual({
      host: 'gitlab',
      owner: 'group',
      name: 'project',
    })
  })

  it('rejects Bitbucket and Codeberg URLs', () => {
    expect(() => parseRepo('https://bitbucket.org/team/repo')).toThrow(/unsupported host/)
    expect(() => parseRepo('https://codeberg.org/user/repo.git')).toThrow(/unsupported host/)
  })

  it('rejects unknown hosts and malformed refs', () => {
    expect(() => parseRepo('https://example.com/a/b')).toThrow(/unsupported host/)
    expect(() => parseRepo('just-one-segment')).toThrow(AppError)
    expect(() => parseRepo('')).toThrow(AppError)
  })
})

describe('repoLabel', () => {
  it('keeps owner/name for GitHub and prefixes host otherwise', () => {
    expect(repoLabel(parseRepo('acme/payments-api'))).toBe('acme/payments-api')
    expect(repoLabel(parseRepo('https://gitlab.com/group/project'))).toBe('gitlab/group/project')
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
