import { AppError } from '../errors'
import * as github from './github'
import * as gitlab from './gitlab'
import { parseRepo, repoLabel } from './repo'
import type { ManifestBundle, RawFile, RepoHost, RepoRef } from './types'

export { parseRepo, repoLabel } from './repo'
export type { ManifestBundle, RawFile, RepoHost, RepoRef } from './types'

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

const HOSTS = { github, gitlab } as const

function hostModule(repo: RepoRef) {
  return HOSTS[repo.host]
}

async function fetchRawFile(repo: RepoRef, branch: string, path: string): Promise<RawFile | null> {
  return hostModule(repo).fetchRawFile(repo, branch, path)
}

async function fetchManifests(repo: RepoRef, branch: string): Promise<RawFile[]> {
  const results = await Promise.all(
    MANIFEST_CANDIDATES.map((path) =>
      fetchRawFile(repo, branch, path).catch((error: unknown) => {
        if (error instanceof AppError && error.status === 502) {
          console.warn(`[${repo.host}] ${repoLabel(repo)}: ${error.message}`)
          return null
        }
        throw error
      })
    )
  )
  return results.filter((file): file is RawFile => file !== null)
}

export async function fetchManifestBundle(repo: RepoRef): Promise<ManifestBundle> {
  const branch = await hostModule(repo).resolveDefaultBranch(repo)
  const files = await fetchManifests(repo, branch)
  if (files.length === 0) {
    throw new AppError(
      404,
      'no_manifests_found',
      `no supported manifests found in ${repoLabel(repo)}`
    )
  }
  return { repo, branch, files, scannedAt: new Date().toISOString() }
}
