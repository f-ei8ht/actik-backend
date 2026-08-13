export interface SeedPackage {
  name: string
  versions?: string[]
}

export const NPM_SEEDS: SeedPackage[] = [
  { name: 'lodash', versions: ['4.17.20'] },
  { name: 'express' },
  { name: 'qs', versions: ['6.5.2'] },
  { name: 'request' },
  { name: 'minimist', versions: ['1.2.5'] },
  { name: 'optimist' },
  { name: 'yargs' },
  { name: 'yargs-parser', versions: ['13.1.1'] },
  { name: 'express-validator' },
  { name: 'schema-utils' },
  { name: 'chokidar' },
  { name: 'strip-ansi' },
  { name: 'ua-parser-js', versions: ['0.7.28'] },
  { name: 'node-fetch' },
  { name: 'axios', versions: ['0.30.4', '1.14.1'] },
  { name: 'keyv', versions: ['6.0.0'] },
  { name: 'cacheable', versions: ['2.5.1'] },
  { name: 'flat-cache', versions: ['6.1.24'] },
  { name: 'file-entry-cache', versions: ['11.1.6'] },
  { name: 'cache-manager', versions: ['7.2.10'] },
  { name: '@bitwarden/cli', versions: ['2026.4.0'] },
  { name: '@cap-js/sqlite', versions: ['2.2.2'] },
]

export const PYPI_SEEDS: SeedPackage[] = [
  { name: 'requests', versions: ['2.26.0'] },
  { name: 'urllib3', versions: ['1.26.4'] },
  { name: 'paramiko' },
  { name: 'cryptography', versions: ['38.0.0'] },
  { name: 'pillow', versions: ['9.1.0'] },
  { name: 'matplotlib' },
  { name: 'pyyaml', versions: ['5.4'] },
  { name: 'mkdocs' },
  { name: 'jinja2' },
  { name: 'flask' },
  { name: 'django' },
  { name: 'aiohttp' },
  { name: 'lxml' },
  { name: 'idna' },
  { name: 'certifi' },
  { name: 'werkzeug' },
  { name: 'litellm', versions: ['1.82.7', '1.82.8'] },
  { name: 'mistralai', versions: ['2.4.6'] },
]
