import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { loadDemoOrg, readLockfile } from '../../../src/ingestion/lockfile/demo-org'
import { parseLockfile } from '../../../src/ingestion/lockfile'
import type { DemoOrgManifest } from '../../../src/ingestion/types'

const demoOrgRoot = resolve(import.meta.dir, '../../../demo-org')

describe('demo-org', () => {
  it('loads the manifest', () => {
    const manifest = loadDemoOrg(demoOrgRoot)
    expect(manifest).not.toBeNull()
    expect(manifest?.org).toBe('Acme')
    expect(manifest?.repositories.length).toBeGreaterThanOrEqual(3)
  })

  it('every lockfile in the manifest parses to at least one resolved dependency', () => {
    const manifest = loadDemoOrg(demoOrgRoot) as DemoOrgManifest
    for (const repo of manifest.repositories) {
      for (const ref of repo.lockfiles) {
        const content = readLockfile(demoOrgRoot, ref.path)
        expect(content, `missing lockfile ${ref.path}`).not.toBeNull()
        const deps = parseLockfile(ref.path, ref.ecosystem, content as string)
        expect(deps.length, `no dependencies parsed from ${ref.path}`).toBeGreaterThan(0)
      }
    }
  })

  it('resolved versions are pinned to versions seeded in the graph', () => {
    const manifest = loadDemoOrg(demoOrgRoot) as DemoOrgManifest
    const expected = new Set([
      'npm:express:5.2.1',
      'npm:lodash:4.17.20',
      'npm:axios:1.14.1',
      'npm:qs:6.5.2',
      'npm:optimist:0.6.1',
      'npm:minimist:1.2.5',
      'PyPI:requests:2.26.0',
      'PyPI:urllib3:1.26.4',
      'PyPI:paramiko:5.0.0',
      'PyPI:matplotlib:3.11.1',
    ])
    const seen = new Set<string>()
    for (const repo of manifest.repositories) {
      for (const ref of repo.lockfiles) {
        const content = readLockfile(demoOrgRoot, ref.path)
        const deps = parseLockfile(ref.path, ref.ecosystem, content as string)
        for (const dep of deps) seen.add(`${dep.ecosystem}:${dep.name}:${dep.resolvedVersion}`)
      }
    }
    for (const key of expected) expect(seen.has(key), `missing resolution ${key}`).toBe(true)
  })
})
