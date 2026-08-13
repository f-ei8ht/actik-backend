export const seedNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:PackageVersion, v.name = n.name, v.version = n.version, v.ecosystem = n.ecosystem
`

export const seedEdgesQuery = `
UNWIND $edges AS e
MATCH (s:PackageVersion {id: e.source}), (t:PackageVersion {id: e.target})
MERGE (s)-[r:DEPENDS_ON {id: e.id}]->(t)
`

export const lookupPackageIdQuery = `
MATCH (v:PackageVersion)
WHERE v.name = $name AND v.version = $version
RETURN v.id AS id
`

export const blastRadiusQuery = (maxDepth = 10) => `
CALL algo.SSpaths({
  sourceNode: $source,
  relTypes: ["DEPENDS_ON"],
  maxLen: ${maxDepth},
  relDirection: "incoming",
  pathCount: 1000
})
YIELD path
RETURN path
`

export const countDirectDependentsQuery = `
MATCH (s {id: $id})<-[:DEPENDS_ON]-(d:PackageVersion)
RETURN count(*) AS count
`

export const upsertPackageNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Package, v.name = n.name, v.ecosystem = n.ecosystem
`

export const upsertVersionNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:PackageVersion,
  v.name = n.name,
  v.version = n.version,
  v.ecosystem = n.ecosystem,
  v.package_id = n.packageId
`

export const upsertMaintainerNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Maintainer, v.name = n.name, v.ecosystem = n.ecosystem
`

export const upsertAdvisoryNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Advisory,
  v.advisory_id = n.advisoryId,
  v.severity = n.severity,
  v.summary = n.summary,
  v.published_at = n.publishedAt,
  v.references = n.references
`

export const upsertEdgesQuery = (type: string, sourceLabel: string, targetLabel: string) => `
UNWIND $edges AS e
MATCH (s:${sourceLabel} {id: e.source}), (t:${targetLabel} {id: e.target})
MERGE (s)-[r:${type} {id: e.id}]->(t)
`
