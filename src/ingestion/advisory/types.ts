import type { AdvisoryNode, Ecosystem } from '../types'

export interface AffectedPackage {
  ecosystem: Ecosystem
  name: string
  versions: string[]
}

export interface AdvisoryRecord {
  node: AdvisoryNode
  affected: AffectedPackage[]
}

export interface AdvisoryPackage {
  ecosystem: Ecosystem
  name: string
  versions: string[]
}
