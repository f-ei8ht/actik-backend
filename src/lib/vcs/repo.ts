import { AppError } from '../errors'
import type { RepoHost, RepoRef } from './types'

const HOST_ALIASES: Record<string, RepoHost> = {
  'github.com': 'github',
  'www.github.com': 'github',
  'gitlab.com': 'gitlab',
  'www.gitlab.com': 'gitlab',
}

const SUPPORTED_HOSTS: RepoHost[] = ['github', 'gitlab']

export function parseRepo(repo: string): RepoRef {
  const clean = repo.trim().replace(/\.git$/, '')

  let host: RepoHost = 'github'
  let path = clean

  const urlMatch = clean.match(/^https?:\/\/([^/]+)\/(.+)$/)
  if (urlMatch) {
    const hostName = urlMatch[1].toLowerCase()
    const alias = HOST_ALIASES[hostName]
    if (!alias) {
      throw new AppError(400, 'invalid_repo', `unsupported host '${urlMatch[1]}'`)
    }
    host = alias
    path = urlMatch[2]
  }

  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2 || parts.length > 3) {
    throw new AppError(
      400,
      'invalid_repo',
      'expected "owner/repo" or a GitHub or GitLab repository URL'
    )
  }
  if (!SUPPORTED_HOSTS.includes(host)) {
    throw new AppError(400, 'invalid_repo', `unsupported host '${host}'`)
  }

  return { host, owner: parts[0], name: parts[1] }
}

/** Display label used in exposure paths and graph evidence. */
export function repoLabel(repo: RepoRef): string {
  return repo.host === 'github'
    ? `${repo.owner}/${repo.name}`
    : `${repo.host}/${repo.owner}/${repo.name}`
}
