import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DemoOrgManifest } from '../types'

export function loadDemoOrg(rootPath: string): DemoOrgManifest | null {
  const manifestPath = resolve(rootPath, 'org.json')
  if (!existsSync(manifestPath)) return null
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as DemoOrgManifest
}

export function readLockfile(rootPath: string, relativePath: string): string | null {
  const filePath = resolve(rootPath, relativePath)
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf8')
}
