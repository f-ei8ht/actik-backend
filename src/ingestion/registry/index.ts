import { env } from '../../lib/config'
import { fetchNpmPackage, fetchPypiPackage } from './registry'
import type { Ecosystem } from '../types'

export type { NpmPackageRaw, PypiPackageRaw } from './registry'

export async function fetchRegistryPackage(
  ecosystem: Ecosystem,
  name: string
): Promise<ReturnType<typeof fetchNpmPackage> | ReturnType<typeof fetchPypiPackage>> {
  switch (ecosystem) {
    case 'npm':
      return fetchNpmPackage(name, env.NPM_REGISTRY_URL)
    case 'PyPI':
      return fetchPypiPackage(name, env.PYPI_JSON_URL)
  }
}
