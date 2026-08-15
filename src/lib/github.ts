import { AppError } from './errors'

const RAW_BASE = 'https://raw.githubusercontent.com'

export interface RepoRef {
  owner: string
  name: string
}

export function parseRepo(repo: string): RepoRef {
  const clean = repo.trim().replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '')
  const parts = clean.split('/').filter(Boolean)
  if (parts.length < 2 || parts.length > 3) {
    throw new AppError(400, 'invalid_repo', 'expected "owner/repo" or a GitHub repository URL')
  }
  return { owner: parts[0], name: parts[1] }
}

export interface RawFile {
  path: string
  content: string
  fetchedAt: string
}

export async function fetchRawFile(repo: RepoRef, path: string): Promise<RawFile | null> {
  const url = `${RAW_BASE}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/HEAD/${path}`
  const response = await fetch(url, { redirect: 'follow' })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new AppError(502, 'github_fetch_failed', `GitHub returned ${response.status} for ${path}`)
  }
  return { path, content: await response.text(), fetchedAt: new Date().toISOString() }
}

export const MANIFEST_CANDIDATES = [
  'package.json',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'yarn.lock',
  'pnpm-lock.yaml',
  'requirements.txt',
  'requirements-dev.txt',
  'pyproject.toml',
  'uv.lock',
  'poetry.lock',
  'Pipfile.lock',
]

export async function fetchManifests(repo: RepoRef): Promise<RawFile[]> {
  const results = await Promise.all(
    MANIFEST_CANDIDATES.map((path) =>
      fetchRawFile(repo, path).catch((error: unknown) => {
        if (error instanceof AppError && error.status === 502) {
          console.warn(`[github] ${repo.owner}/${repo.name}: ${error.message}`)
          return null
        }
        throw error
      })
    )
  )
  return results.filter((file): file is RawFile => file !== null)
}

export interface ManifestBundle {
  repo: RepoRef
  files: RawFile[]
  scannedAt: string
}

export async function fetchManifestBundle(repo: RepoRef): Promise<ManifestBundle> {
  const files = await fetchManifests(repo)
  if (files.length === 0) {
    throw new AppError(
      404,
      'no_manifests_found',
      `no supported manifests found in ${repo.owner}/${repo.name}`
    )
  }
  return { repo, files, scannedAt: new Date().toISOString() }
}
