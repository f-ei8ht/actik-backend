import { hydra, type HydraClient } from '../hydra/client'
import {
  upsertAdvisoryNodesQuery,
  upsertApplicationNodesQuery,
  upsertEdgesQuery,
  upsertMaintainerNodesQuery,
  upsertPackageNodesQuery,
  upsertVersionNodesQuery,
} from '../hydra/queries'
import type {
  AdvisoryNode,
  ApplicationNode,
  Edge,
  MaintainerNode,
  PackageNode,
  PackageVersionNode,
} from './types'

export const WRITE_BATCH_SIZE = 500

export const EDGE_SPECS: Record<string, { sourceLabel: string; targetLabel: string }> = {
  HAS_VERSION: { sourceLabel: 'Package', targetLabel: 'PackageVersion' },
  MAINTAINED_BY: { sourceLabel: 'Package', targetLabel: 'Maintainer' },
  DEPENDS_ON: { sourceLabel: 'PackageVersion', targetLabel: 'PackageVersion' },
  AFFECTED_BY: { sourceLabel: 'PackageVersion', targetLabel: 'Advisory' },
  USED_BY: { sourceLabel: 'PackageVersion', targetLabel: 'Application' },
}

export interface WriteSummary {
  packages: number
  versions: number
  maintainers: number
  advisories: number
  applications: number
  edges: Record<string, number>
}

export class GraphWriter {
  private readonly edges: Record<string, Edge[]> = {}

  constructor(private readonly client: HydraClient = hydra) {}

  addPackages(nodes: PackageNode[]) {
    this.writeBatches(upsertPackageNodesQuery, nodes, 'nodes')
  }

  addVersions(nodes: PackageVersionNode[]) {
    this.writeBatches(upsertVersionNodesQuery, nodes, 'nodes')
  }

  addMaintainers(nodes: MaintainerNode[]) {
    this.writeBatches(upsertMaintainerNodesQuery, nodes, 'nodes')
  }

  addAdvisories(nodes: AdvisoryNode[]) {
    this.writeBatches(upsertAdvisoryNodesQuery, nodes, 'nodes')
  }

  addApplications(nodes: ApplicationNode[]) {
    this.writeBatches(upsertApplicationNodesQuery, nodes, 'nodes')
  }

  addEdges(type: string, edges: Edge[]) {
    if (edges.length === 0) return
    const bucket = (this.edges[type] ??= [])
    bucket.push(...edges)
  }

  async flush(): Promise<WriteSummary> {
    const edgeTypes = Object.keys(this.edges)
    for (const type of edgeTypes) {
      const spec = EDGE_SPECS[type]
      if (!spec) throw new Error(`no edge spec registered for type ${type}`)
      const query = upsertEdgesQuery(type, spec.sourceLabel, spec.targetLabel)
      const edges = this.edges[type]
      for (let i = 0; i < edges.length; i += WRITE_BATCH_SIZE) {
        await this.client.query(query, { parameters: { edges: edges.slice(i, i + WRITE_BATCH_SIZE) } })
      }
    }
    return {
      packages: this.packageCount,
      versions: this.versionCount,
      maintainers: this.maintainerCount,
      advisories: this.advisoryCount,
      applications: this.applicationCount,
      edges: Object.fromEntries(edgeTypes.map((type) => [type, this.edges[type].length])),
    }
  }

  private packageCount = 0
  private versionCount = 0
  private maintainerCount = 0
  private advisoryCount = 0
  private applicationCount = 0

  private async writeBatches(
    query: string,
    rows: Array<Record<string, unknown>>,
    parameter: 'nodes'
  ) {
    for (let i = 0; i < rows.length; i += WRITE_BATCH_SIZE) {
      await this.client.query(query, {
        parameters: { [parameter]: rows.slice(i, i + WRITE_BATCH_SIZE) },
      })
    }
    switch (query) {
      case upsertPackageNodesQuery:
        this.packageCount += rows.length
        break
      case upsertVersionNodesQuery:
        this.versionCount += rows.length
        break
      case upsertMaintainerNodesQuery:
        this.maintainerCount += rows.length
        break
      case upsertAdvisoryNodesQuery:
        this.advisoryCount += rows.length
        break
      case upsertApplicationNodesQuery:
        this.applicationCount += rows.length
        break
    }
  }
}
