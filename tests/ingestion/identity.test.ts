import { describe, expect, it } from 'bun:test'
import {
  advisoryAffectedVersionsQuery,
  advisoryByIdQuery,
  advisoryCountForPackageQuery,
  dependenciesQuery,
  dependentsQuery,
  lookupPackageIdQuery,
  maintainersOfPackageQuery,
  packageByNameQuery,
  sharedMaintainersQuery,
  versionCountQuery,
  versionDetailsQuery,
  versionsOfPackageQuery,
} from '../../src/hydra/queries'
import { packageVersionId } from '../../src/ingestion/types'

describe('ecosystem-aware package identity', () => {
  it('produces distinct version ids for the same name/version across ecosystems', () => {
    expect(packageVersionId('npm', 'requests', '2.31.0')).not.toBe(
      packageVersionId('PyPI', 'requests', '2.31.0')
    )
  })

  it('includes the ecosystem filter only when requested', () => {
    expect(lookupPackageIdQuery()).not.toContain('$ecosystem')
    expect(lookupPackageIdQuery('npm')).toContain('v.ecosystem = $ecosystem')

    expect(versionDetailsQuery()).not.toContain('$ecosystem')
    expect(versionDetailsQuery('PyPI')).toContain('v.ecosystem = $ecosystem')
  })

  it('adds the ecosystem filter to every version lookup query', () => {
    const withEcosystem = [
      lookupPackageIdQuery('npm'),
      packageByNameQuery('npm'),
      versionsOfPackageQuery('npm'),
      versionDetailsQuery('npm'),
      versionCountQuery('npm'),
      dependenciesQuery('npm'),
      dependentsQuery('npm'),
      maintainersOfPackageQuery('npm'),
      sharedMaintainersQuery('npm'),
      advisoryCountForPackageQuery('npm'),
    ]
    for (const query of withEcosystem) {
      expect(query).toContain('$ecosystem')
    }
  })

  it('keeps advisory-by-id queries ecosystem-agnostic', () => {
    // advisories are keyed by globally-unique advisory id
    expect(advisoryByIdQuery).not.toContain('$ecosystem')
    expect(advisoryAffectedVersionsQuery).not.toContain('$ecosystem')
  })
})
