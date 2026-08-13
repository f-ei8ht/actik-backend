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
  { name: 'axios' },
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
]
