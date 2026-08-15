import { describe, expect, it } from 'bun:test'
import { parseRequirements } from '../../../src/ingestion/lockfile/requirements'
import { parseUvLock } from '../../../src/ingestion/lockfile/uv-lock'
import { parseLockfile } from '../../../src/ingestion/lockfile'

describe('parseRequirements', () => {
  it('parses pinned requirements with comments', () => {
    const deps = parseRequirements(`
# comment
requests==2.26.0
matplotlib==3.11.1  # pinned for demo
-r other.txt
`)

    expect(deps).toEqual([
      { ecosystem: 'PyPI', name: 'matplotlib', requestedVersion: '3.11.1', resolvedVersion: '3.11.1' },
      { ecosystem: 'PyPI', name: 'requests', requestedVersion: '2.26.0', resolvedVersion: '2.26.0' },
    ])
  })

  it('ignores non-pinned lines', () => {
    const deps = parseRequirements('numpy\npandas>=2.0.0\nflask~=3.0\n')
    expect(deps).toEqual([])
  })
})

describe('parseUvLock', () => {
  const lock = `
version = 1
requires-python = ">=3.11"

[[package]]
name = "analytics-worker"
version = "1.0.0"
source = { editable = "." }
dependencies = [
    { name = "requests" },
]

[[package]]
name = "requests"
version = "2.26.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "urllib3"
version = "1.26.4"
source = { registry = "https://pypi.org/simple" }
`

  it('parses resolved packages and skips the editable project', () => {
    const deps = parseUvLock(lock)
    expect(deps).toEqual([
      { ecosystem: 'PyPI', name: 'requests', resolvedVersion: '2.26.0' },
      { ecosystem: 'PyPI', name: 'urllib3', resolvedVersion: '1.26.4' },
    ])
  })
})

describe('parseLockfile dispatch', () => {
  it('dispatches npm, uv.lock and requirements.txt by path', () => {
    const npm = parseLockfile(
      'x/package-lock.json',
      'npm',
      JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/lodash': { version: '4.17.20' } } })
    )
    expect(npm[0].ecosystem).toBe('npm')
    expect(npm[0].name).toBe('lodash')
    expect(parseLockfile('x/uv.lock', 'PyPI', '')?.length).toBe(0)
    expect(parseLockfile('x/requirements.txt', 'PyPI', 'requests==2.26.0')).toHaveLength(1)
  })

  it('throws for unsupported lockfiles', () => {
    expect(() => parseLockfile('x/bun.lockb', 'npm', '')).toThrow(/binary/)
    expect(() => parseLockfile('x/weird.lock', 'PyPI', '')).toThrow(/unsupported lockfile/)
  })
})
