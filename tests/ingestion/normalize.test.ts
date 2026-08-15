import { describe, expect, it } from 'bun:test'
import {
  affectedPackages,
  isAffectedVersion,
  normalizeAdvisory,
  normalizePackage,
} from '../../src/ingestion/normalize'
import type { NpmPackageRaw, PypiPackageRaw } from '../../src/ingestion/registry/registry'
import { packageVersionId } from '../../src/ingestion/types'
import type { OsvVulnDoc } from '../../src/ingestion/version'

const npmRaw: NpmPackageRaw = {
  name: 'lodash',
  latest: '4.17.21',
  maintainers: [{ name: 'jdalton' }, { name: 'mathias' }],
  versions: {
    '4.17.20': { version: '4.17.20', dependencies: {} },
    '4.17.21': { version: '4.17.21', dependencies: {} },
  },
}

const pypiRaw: PypiPackageRaw = {
  name: 'requests',
  latest: '2.32.0',
  author: 'Kenneth Reitz',
  authorEmail: 'me@kennethreitz.org',
  maintainer: '',
  maintainerEmail: '',
  requiresDist: [
    { name: 'urllib3', specifier: '<3,>=1.21.1' },
    { name: 'certifi', specifier: '>=2017.4.17' },
  ],
}

describe('normalizePackage (npm)', () => {
  it('creates the package and selected versions with stable ids', () => {
    const result = normalizePackage('npm', npmRaw, { pinnedVersions: ['4.17.20'] })
    expect(result.packageNode).toEqual({ id: expect.any(Number), name: 'lodash', ecosystem: 'npm' })
    expect(result.versionNodes.map((v) => v.version).sort()).toEqual(['4.17.20', '4.17.21'])
    const vulnerable = result.versionNodes.find((v) => v.version === '4.17.20')
    expect(vulnerable?.id).toBe(packageVersionId('npm', 'lodash', '4.17.20'))
    expect(result.hasVersionEdges).toHaveLength(2)
    expect(result.hasVersionEdges[0]).toMatchObject({ source: result.packageNode.id })
  })

  it('extracts maintainers and edges', () => {
    const result = normalizePackage('npm', npmRaw, { pinnedVersions: ['4.17.20'] })
    expect(result.maintainerNodes.map((m) => m.name).sort()).toEqual(['jdalton', 'mathias'])
    expect(result.maintainerEdges).toHaveLength(2)
  })

  it('collects per-version dependency specs with ranges', () => {
    const rawWithDeps: NpmPackageRaw = {
      ...npmRaw,
      versions: {
        ...npmRaw.versions,
        '4.17.21': { version: '4.17.21', dependencies: { 'ansi-regex': '^5.0.0' } },
      },
    }
    const result = normalizePackage('npm', rawWithDeps, { pinnedVersions: ['4.17.20'] })
    expect(result.dependencySpecs).toEqual([
      { source: packageVersionId('npm', 'lodash', '4.17.21'), name: 'ansi-regex', range: '^5.0.0' },
    ])
  })
})

describe('normalizePackage (PyPI)', () => {
  it('creates nodes and collects requires_dist deps', () => {
    const result = normalizePackage('PyPI', pypiRaw)
    expect(result.packageNode.ecosystem).toBe('PyPI')
    expect(result.versionNodes.map((v) => v.version)).toEqual(['2.32.0'])
    expect(result.dependencySpecs.map((s) => s.name).sort()).toEqual(['certifi', 'urllib3'])
    expect(result.maintainerNodes.map((m) => m.name)).toContain('Kenneth Reitz')
  })
})

describe('normalizeAdvisory', () => {
  const doc: OsvVulnDoc = {
    id: 'GHSA-XXXX',
    summary: 'Prototype pollution in lodash',
    published: '2021-01-26T00:00:00Z',
    modified: '2021-02-01T00:00:00Z',
    database_specific: { severity: 'HIGH' },
    references: [{ url: 'https://example.com/advisory' }],
    affected: [
      {
        package: { ecosystem: 'npm', name: 'lodash' },
        versions: ['4.17.20'],
      },
    ],
  }

  it('builds the advisory node', () => {
    const node = normalizeAdvisory(doc)
    expect(node.advisoryId).toBe('GHSA-XXXX')
    expect(node.severity).toBe('HIGH')
    expect(node.summary).toBe('Prototype pollution in lodash')
    expect(node.references).toBe('https://example.com/advisory')
    expect(node.publishedAt).toBe('2021-01-26T00:00:00Z')
    expect(node.modifiedAt).toBe('2021-02-01T00:00:00Z')
  })

  it('derives severity from cvss score when database severity is absent', () => {
    const node = normalizeAdvisory({ ...doc, database_specific: undefined, severity: [{ score: 9.8 }] })
    expect(node.severity).toBe('CRITICAL')
  })

  it('lists affected packages and matches versions', () => {
    expect(affectedPackages(doc)).toEqual([{ ecosystem: 'npm', name: 'lodash' }])
    expect(isAffectedVersion(doc, 'npm', 'lodash', '4.17.20')).toBe(true)
    expect(isAffectedVersion(doc, 'npm', 'lodash', '4.17.21')).toBe(false)
  })
})
