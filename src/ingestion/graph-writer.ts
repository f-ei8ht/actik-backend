import { hydra, type HydraClient } from '../hydra/client'
import {
  upsertAdvisoryNodesQuery,
  upsertEdgesQuery,
  upsertLockfileNodesQuery,
  upsertMaintainerNodesQuery,
  upsertOrganizationNodesQuery,
  upsertPackageNodesQuery,
  upsertRepositoryNodesQuery,
  upsertResolvesEdgesQuery,
  upsertVersionNodesQuery,
} from '../hydra/queries'
import type {
  AdvisoryNode,
  Edge,
  LockfileNode,
  MaintainerNode,
  OrganizationNode,
  PackageNode,
  PackageVersionNode,
  RepositoryNode,
  ResolvesEdge,
} from './types'

export const WRITE_BATCH_SIZE = 500

export const EDGE_SPECS: Record<string, { sourceLabel: string; targetLabel: string }> = {
  HAS_VERSION: { sourceLabel: 'Package', targetLabel: 'PackageVersion' },
  MAINTAINED_BY: { sourceLabel: 'Package', targetLabel: 'Maintainer' },
  DEPENDS_ON: { sourceLabel: 'PackageVersion', targetLabel: 'PackageVersion' },
  AFFECTED_BY: { sourceLabel: 'PackageVersion', targetLabel: 'Advisory' },
  OWNS: { sourceLabel: 'Organization', targetLabel: 'Repository' },
  HAS_LOCKFILE: { sourceLabel: 'Repository', targetLabel: 'Lockfile' },
  RESOLVES: { sourceLabel: 'Lockfile', targetLabel: 'PackageVersion' },
}

export interface WriteSummary {
  packages: number
  versions: number
  maintainers: number
  advisories: number
  organizations: number
  repositories: number
  lockfiles: number
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

  addOrganizations(nodes: OrganizationNode[]) {
    this.writeBatches(upsertOrganizationNodesQuery, nodes, 'nodes')
  }

  addRepositories(nodes: RepositoryNode[]) {
    this.writeBatches(upsertRepositoryNodesQuery, nodes, 'nodes')
  }

  addLockfiles(nodes: LockfileNode[]) {
    this.writeBatches(upsertLockfileNodesQuery, nodes, 'nodes')
  }

  addEdges(type: string, edges: Edge[]) {
    if (edges.length === 0) return
    const bucket = (this.edges[type] ??= [])
    bucket.push(...edges)
  }

  async flush(): Promise<WriteSummary> {
    const edgeTypes = Object.keys(this.edges)
    for (const type of edgeTypes) {
      const query = this.edgeQuery(type)
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
      organizations: this.organizationCount,
      repositories: this.repositoryCount,
      lockfiles: this.lockfileCount,
      edges: Object.fromEntries(edgeTypes.map((type) => [type, this.edges[type].length])),
    }
  }

  private edgeQuery(type: string): string {
    if (type === 'RESOLVES') return upsertResolvesEdgesQuery
    const spec = EDGE_SPECS[type]
    if (!spec) throw new Error(`no edge spec registered for type ${type}`)
    return upsertEdgesQuery(type, spec.sourceLabel, spec.targetLabel)
  }

  private packageCount = 0
  private versionCount = 0
  private maintainerCount = 0
  private advisoryCount = 0
  private organizationCount = 0
  private repositoryCount = 0
  private lockfileCount = 0

  private async writeBatches(
    query: string,
    rows: ReadonlyArray<object>,
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
      case upsertOrganizationNodesQuery:
        this.organizationCount += rows.length
        break
      case upsertRepositoryNodesQuery:
        this.repositoryCount += rows.length
        break
      case upsertLockfileNodesQuery:
        this.lockfileCount += rows.length
        break
    }
  }
}
