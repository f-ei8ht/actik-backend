import { AppError } from '../errors'
import type { RawFile, RepoRef } from './types'

const FALLBACK_BRANCH = 'HEAD'

interface GithubRepoDoc {
  default_branch?: string
}

export async function resolveDefaultBranch(repo: RepoRef): Promise<string> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return FALLBACK_BRANCH
    const doc = (await response.json()) as GithubRepoDoc
    return doc.default_branch ?? FALLBACK_BRANCH
  } catch {
    return FALLBACK_BRANCH
  }
}

export function rawUrl(repo: RepoRef, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/${encodeURIComponent(branch)}/${path}`
}

export async function fetchRawFile(
  repo: RepoRef,
  branch: string,
  path: string
): Promise<RawFile | null> {
  const response = await fetch(rawUrl(repo, branch, path), { redirect: 'follow' })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new AppError(502, 'repo_fetch_failed', `github returned ${response.status} for ${path}`)
  }
  return { path, content: await response.text(), fetchedAt: new Date().toISOString() }
}
