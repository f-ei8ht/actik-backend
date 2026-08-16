export type RepoHost = 'github' | 'gitlab' | 'bitbucket' | 'codeberg'

export interface RepoRef {
  host: RepoHost
  owner: string
  name: string
}

export interface RawFile {
  path: string
  content: string
  fetchedAt: string
}

export interface ManifestBundle {
  repo: RepoRef
  branch: string
  files: RawFile[]
  scannedAt: string
}
