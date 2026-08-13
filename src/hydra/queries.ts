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

export const packageByNameQuery = `
MATCH (p:Package)
WHERE p.name = $name
RETURN p.name AS name, p.ecosystem AS ecosystem
`

export const versionsOfPackageQuery = `
MATCH (v:PackageVersion)
WHERE v.name = $name
RETURN v.version AS version
ORDER BY version
`

export const versionDetailsQuery = `
MATCH (v:PackageVersion)
WHERE v.name = $name AND v.version = $version
RETURN v.name AS name, v.version AS version, v.ecosystem AS ecosystem
`

export const versionCountQuery = `
MATCH (v:PackageVersion)
WHERE v.name = $name
RETURN count(*) AS count
`

export const dependenciesQuery = `
MATCH (v:PackageVersion)
WHERE v.name = $name AND v.version = $version
MATCH (v)-[r:DEPENDS_ON]->(t:PackageVersion)
RETURN t.name AS name, t.version AS version, t.ecosystem AS ecosystem
ORDER BY t.name, t.version
`

export const dependentsQuery = `
MATCH (v:PackageVersion)
WHERE v.name = $name AND v.version = $version
MATCH (d:PackageVersion)-[r:DEPENDS_ON]->(v)
RETURN d.name AS name, d.version AS version, d.ecosystem AS ecosystem
ORDER BY d.name, d.version
`

export const maintainersOfPackageQuery = `
MATCH (p:Package)-[:MAINTAINED_BY]->(m:Maintainer)
WHERE p.name = $name
RETURN m.name AS name
ORDER BY m.name
`

export const sharedMaintainersQuery = `
MATCH (p:Package)-[:MAINTAINED_BY]->(m:Maintainer)<-[:MAINTAINED_BY]-(q:Package)
WHERE p.name = $name AND q.name <> $name
RETURN q.name AS name, m.name AS maintainer
ORDER BY q.name
`

export const advisoryByIdQuery = `
MATCH (a:Advisory)
WHERE a.advisory_id = $id
RETURN a.advisory_id AS id, a.severity AS severity, a.summary AS summary,
  a.published_at AS publishedAt, a.references AS references
`

export const advisoryAffectedVersionsQuery = `
MATCH (v:PackageVersion)-[:AFFECTED_BY]->(a:Advisory)
WHERE a.advisory_id = $id
RETURN v.name AS name, v.version AS version, v.ecosystem AS ecosystem
ORDER BY v.name, v.version
`

export const advisoriesForVersionQuery = `
MATCH (v:PackageVersion)-[:AFFECTED_BY]->(a:Advisory)
WHERE v.name = $name AND v.version = $version
RETURN a.advisory_id AS id, a.severity AS severity, a.summary AS summary
ORDER BY a.severity
`

export const advisoryCountForPackageQuery = `
MATCH (v:PackageVersion)-[:AFFECTED_BY]->(a:Advisory)
WHERE v.name = $name
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
