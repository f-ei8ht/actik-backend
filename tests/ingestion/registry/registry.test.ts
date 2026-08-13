import { afterEach, describe, expect, it, mock } from 'bun:test'
import { fetchNpmPackage, fetchPypiPackage, parsePypiRequiresDist } from '../../../src/ingestion/registry/registry'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('parsePypiRequiresDist', () => {
  it('parses name and specifier', () => {
    expect(parsePypiRequiresDist('requests (>=2.0,<3)')).toEqual([{ name: 'requests', specifier: '>=2.0,<3' }])
  })

  it('parses unparenthesized specifiers', () => {
    expect(parsePypiRequiresDist('urllib3<3,>=1.26')).toEqual([{ name: 'urllib3', specifier: '<3,>=1.26' }])
    expect(parsePypiRequiresDist('charset_normalizer<4,>=2')).toEqual([{ name: 'charset_normalizer', specifier: '<4,>=2' }])
  })

  it('parses bare names', () => {
    expect(parsePypiRequiresDist('click')).toEqual([{ name: 'click', specifier: null }])
  })

  it('drops environment markers', () => {
    expect(parsePypiRequiresDist("ujson; python_version < '3.8'")).toEqual([{ name: 'ujson', specifier: null }])
  })

  it('drops extra-only optional dependencies', () => {
    expect(parsePypiRequiresDist('PySocks!=1.5.7,>=1.5.6; extra == "socks"')).toEqual([])
  })

  it('ignores malformed entries', () => {
    expect(parsePypiRequiresDist('')).toEqual([])
  })
})

describe('fetchNpmPackage', () => {
  it('fetches and shapes the npm document', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        name: 'lodash',
        'dist-tags': { latest: '4.17.21' },
        maintainers: [{ name: 'jdalton' }],
        versions: { '4.17.21': { version: '4.17.21', dependencies: { x: '^1.0.0' } } },
      })
    )

    const raw = await fetchNpmPackage('lodash', 'https://registry.npmjs.org')
    expect(raw).toEqual({
      name: 'lodash',
      latest: '4.17.21',
      maintainers: [{ name: 'jdalton' }],
      versions: { '4.17.21': { version: '4.17.21', dependencies: { x: '^1.0.0' } } },
    })
    expect(String((globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0])).toBe(
      'https://registry.npmjs.org/lodash'
    )
  })

  it('returns null for 404', async () => {
    globalThis.fetch = mock(async () => new Response('not found', { status: 404 }))
    expect(await fetchNpmPackage('nope', 'https://registry.npmjs.org')).toBeNull()
  })
})

describe('fetchPypiPackage', () => {
  it('fetches and shapes the PyPI document', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        info: {
          name: 'requests',
          version: '2.32.0',
          author: 'Kenneth Reitz',
          author_email: 'me@kennethreitz.org',
          requires_dist: ['urllib3 (<3,>=1.21.1)'],
        },
      })
    )

    const raw = await fetchPypiPackage('requests', 'https://pypi.org/pypi')
    expect(raw?.latest).toBe('2.32.0')
    expect(raw?.author).toBe('Kenneth Reitz')
    expect(raw?.requiresDist).toEqual([{ name: 'urllib3', specifier: '<3,>=1.21.1' }])
    expect(String((globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0])).toBe(
      'https://pypi.org/pypi/requests/json'
    )
  })

  it('returns null for 404', async () => {
    globalThis.fetch = mock(async () => new Response('not found', { status: 404 }))
    expect(await fetchPypiPackage('nope', 'https://pypi.org/pypi')).toBeNull()
  })
})
