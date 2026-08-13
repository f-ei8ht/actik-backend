export interface NpmVersionEntry {
  version: string
  dependencies?: Record<string, string>
}

export interface NpmPackageRaw {
  name: string
  latest: string
  maintainers: Array<{ name?: string; email?: string }>
  versions: Record<string, NpmVersionEntry>
}

export interface PypiDependencyEntry {
  name: string
  specifier: string | null
}

export interface PypiPackageRaw {
  name: string
  latest: string
  author: string
  authorEmail: string
  maintainer: string
  maintainerEmail: string
  requiresDist: PypiDependencyEntry[]
}

export async function fetchNpmPackage(
  name: string,
  registryUrl: string
): Promise<NpmPackageRaw | null> {
  const response = await fetch(`${registryUrl.replace(/\/+$/, '')}/${encodeURIComponent(name)}`)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`npm registry ${response.status} for ${name}: ${await response.text()}`)
  }
  const doc = (await response.json()) as {
    name?: string
    'dist-tags'?: { latest?: string }
    maintainers?: Array<{ name?: string; email?: string }>
    versions?: Record<string, NpmVersionEntry>
  }
  return {
    name: doc.name ?? name,
    latest: doc['dist-tags']?.latest ?? '',
    maintainers: Array.isArray(doc.maintainers) ? doc.maintainers : [],
    versions: doc.versions ?? {},
  }
}

export async function fetchPypiPackage(
  name: string,
  jsonUrl: string
): Promise<PypiPackageRaw | null> {
  const response = await fetch(`${jsonUrl.replace(/\/+$/, '')}/${encodeURIComponent(name)}/json`)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`PyPI registry ${response.status} for ${name}: ${await response.text()}`)
  }
  const doc = (await response.json()) as {
    info?: {
      name?: string
      version?: string
      author?: string
      author_email?: string
      maintainer?: string
      maintainer_email?: string
      requires_dist?: string[]
    }
  }
  const info = doc.info ?? {}
  return {
    name: info.name ?? name,
    latest: info.version ?? '',
    author: info.author ?? '',
    authorEmail: info.author_email ?? '',
    maintainer: info.maintainer ?? '',
    maintainerEmail: info.maintainer_email ?? '',
    requiresDist: (info.requires_dist ?? []).flatMap(parsePypiRequiresDist),
  }
}

export function parsePypiRequiresDist(entry: string): PypiDependencyEntry[] {
  const [requirement, marker] = entry.split(';')
  if (marker?.includes('extra')) return []
  const withoutMarker = requirement.trim()
  if (!withoutMarker) return []
  const match = withoutMarker.match(/^([A-Za-z0-9._-]+)\s*(?:\(\s*([^)]*?)\s*\)|(.*))?$/)
  if (!match || !match[1]) return []
  const name = match[1]
  const specifier = (match[2] ?? match[3] ?? '').trim() || null
  return [{ name, specifier }]
}
