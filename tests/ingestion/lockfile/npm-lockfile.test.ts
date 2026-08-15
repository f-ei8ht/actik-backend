import { describe, expect, it } from 'bun:test'
import { parseNpmPackageLock } from '../../../src/ingestion/lockfile/npm-lockfile'

describe('parseNpmPackageLock', () => {
  it('parses lockfile v3 packages map with requested versions from the root', () => {
    const deps = parseNpmPackageLock(JSON.stringify({
      name: 'payments-api',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'payments-api',
          dependencies: {
            express: '^5.2.1',
            lodash: '^4.17.20',
          },
        },
        'node_modules/express': { version: '5.2.1' },
        'node_modules/lodash': { version: '4.17.20' },
      },
    }))

    expect(deps).toEqual([
      { ecosystem: 'npm', name: 'express', requestedVersion: '^5.2.1', resolvedVersion: '5.2.1', path: 'node_modules/express' },
      { ecosystem: 'npm', name: 'lodash', requestedVersion: '^4.17.20', resolvedVersion: '4.17.20', path: 'node_modules/lodash' },
    ])
  })

  it('parses nested and scoped package keys', () => {
    const deps = parseNpmPackageLock(JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/express/node_modules/qs': { version: '6.5.2' },
        'node_modules/@scope/pkg': { version: '2.0.0' },
      },
    }))

    expect(deps).toContainEqual({ ecosystem: 'npm', name: 'qs', requestedVersion: undefined, resolvedVersion: '6.5.2', path: 'node_modules/express/node_modules/qs' })
    expect(deps).toContainEqual({ ecosystem: 'npm', name: '@scope/pkg', requestedVersion: undefined, resolvedVersion: '2.0.0', path: 'node_modules/@scope/pkg' })
  })

  it('keeps distinct versions of the same package at nested paths', () => {
    const deps = parseNpmPackageLock(JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/foo': { version: '1.2.3' },
        'node_modules/bar/node_modules/foo': { version: '2.0.0' },
      },
    }))

    expect(deps).toHaveLength(2)
    expect(deps).toContainEqual({ ecosystem: 'npm', name: 'foo', requestedVersion: undefined, resolvedVersion: '1.2.3', path: 'node_modules/foo' })
    expect(deps).toContainEqual({ ecosystem: 'npm', name: 'foo', requestedVersion: undefined, resolvedVersion: '2.0.0', path: 'node_modules/bar/node_modules/foo' })
  })

  it('falls back to the v1/v2 dependencies map', () => {
    const deps = parseNpmPackageLock(JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        express: { version: '5.2.1', requires: { qs: '^6.5.2' } },
      },
    }))

    expect(deps).toEqual([
      { ecosystem: 'npm', name: 'express', requestedVersion: undefined, resolvedVersion: '5.2.1', path: 'node_modules/express' },
    ])
  })

  it('ignores the root project entry', () => {
    const deps = parseNpmPackageLock(JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'payments-api', version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.20' },
      },
    }))

    expect(deps).toHaveLength(1)
    expect(deps[0].name).toBe('lodash')
  })
})
